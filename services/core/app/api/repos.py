import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Chunk, DependencyEdge, File, Repository
from app.db.session import get_session
from app.embeddings import embed_query
from app.ingestion.pipeline import create_pending_repository, run_ingestion
from app.rag import answer_question
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ChatSourceResponse,
    DependencyEdgeResponse,
    FileResponse,
    RepoIngestRequest,
    RepositoryResponse,
    SearchResultResponse,
)

router = APIRouter(prefix="/repos", tags=["repos"])


@router.post("", response_model=RepositoryResponse)
async def create_repo(
    body: RepoIngestRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    repository = await create_pending_repository(session, body.clone_url)
    background_tasks.add_task(run_ingestion, repository.id)
    return repository


@router.get("", response_model=list[RepositoryResponse])
async def list_repos(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Repository).order_by(Repository.created_at.desc()))
    return result.scalars().all()


async def _get_repo_or_404(repo_id: uuid.UUID, session: AsyncSession) -> Repository:
    repository = await session.get(Repository, repo_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="repository not found")
    return repository


@router.get("/{repo_id}", response_model=RepositoryResponse)
async def get_repo(repo_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    return await _get_repo_or_404(repo_id, session)


@router.get("/{repo_id}/files", response_model=list[FileResponse])
async def list_files(repo_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    await _get_repo_or_404(repo_id, session)
    result = await session.execute(
        select(File)
        .where(File.repository_id == repo_id)
        .options(selectinload(File.symbols), selectinload(File.summary), selectinload(File.ownership))
        .order_by(File.path)
    )
    return result.scalars().all()


@router.get("/{repo_id}/graph", response_model=list[DependencyEdgeResponse])
async def get_graph(repo_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    await _get_repo_or_404(repo_id, session)
    result = await session.execute(select(DependencyEdge).where(DependencyEdge.repository_id == repo_id))
    return result.scalars().all()


@router.get("/{repo_id}/search", response_model=list[SearchResultResponse])
async def search_repo(
    repo_id: uuid.UUID, q: str, limit: int = 10, session: AsyncSession = Depends(get_session)
):
    """Raw retrieval endpoint over code chunks only — kept for debugging.
    /chat below is the actual RAG pipeline (code + commits + PRs/issues)."""
    await _get_repo_or_404(repo_id, session)
    try:
        query_embedding = embed_query(q)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"embedding failed: {exc}") from exc

    distance = Chunk.embedding.cosine_distance(query_embedding).label("distance")
    result = await session.execute(
        select(File.path, Chunk.content, Chunk.start_line, Chunk.end_line, distance)
        .join(File, File.id == Chunk.file_id)
        .where(File.repository_id == repo_id)
        .order_by(distance)
        .limit(limit)
    )
    return [
        SearchResultResponse(
            file_path=row.path,
            chunk_content=row.content,
            start_line=row.start_line,
            end_line=row.end_line,
            distance=row.distance,
        )
        for row in result.all()
    ]


@router.post("/{repo_id}/chat", response_model=ChatResponse)
async def chat(repo_id: uuid.UUID, body: ChatRequest, session: AsyncSession = Depends(get_session)):
    """Stateless: the client holds conversation history and resends it each
    turn. The last message must be from the user — that's the question this
    turn answers; earlier messages are context only."""
    await _get_repo_or_404(repo_id, session)
    if not body.messages or body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="last message must have role 'user'")

    question = body.messages[-1].content
    history = [(m.role, m.content) for m in body.messages[:-1]]

    try:
        answer, sources = await answer_question(session, repo_id, question, history)
    except Exception as exc:
        # Raised (not left to propagate) so this is handled by Starlette's
        # ExceptionMiddleware, which runs inside CORSMiddleware — an
        # exception that reaches the outer ServerErrorMiddleware instead
        # produces a response with no CORS headers, which browsers report
        # as an opaque "Failed to fetch" rather than a readable error.
        raise HTTPException(status_code=502, detail=f"chat answer generation failed: {exc}") from exc

    return ChatResponse(
        answer=answer,
        sources=[
            ChatSourceResponse(kind=s.kind, label=s.label, content=s.content[:500], url=s.url, distance=s.distance)
            for s in sources
        ],
        not_enough_information=not sources,
    )
