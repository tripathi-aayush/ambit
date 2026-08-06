import asyncio
import shutil
import uuid
from contextlib import AsyncExitStack
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.architecture import generate_architecture_doc
from app.config import settings
from app.db.models import Chunk, DependencyEdge, File, Plan, Repository, RepositoryDoc
from app.db.session import get_session
from app.embeddings import embed_query
from app.executor import get_plan_lock
from app.ingestion.pipeline import create_pending_repository, find_repo_by_clone_url, run_ingestion
from app.rag import answer_question
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ChatSourceResponse,
    DependencyEdgeResponse,
    FileResponse,
    RepoIngestRequest,
    RepositoryDocResponse,
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
    # Sprint 2 / audit H5: return the existing repository instead of
    # re-cloning/re-embedding/re-indexing the same URL. A previously
    # *failed* ingestion is retried in place (resubmitting the same URL to
    # retry was the only way to recover before this fix -- preserved
    # rather than replaced with something new); anything else (ready,
    # pending, processing) is returned as-is with no new work triggered.
    existing = await find_repo_by_clone_url(session, body.clone_url)
    if existing is not None:
        if existing.status == "failed":
            existing.status = "pending"
            existing.error = None
            await session.commit()
            await session.refresh(existing)
            background_tasks.add_task(run_ingestion, existing.id)
        return existing

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


@router.delete("/{repo_id}", status_code=204)
async def delete_repo(repo_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Sprint 2 / audit H3: deletes the repository and everything under
    it -- files/chunks/symbols/summaries/ownership, its architecture doc,
    and all of its plans (with their actions/events/approvals), then
    removes the on-disk clone and each plan's working directory.

    Two things aren't modeled as ORM relationships and are cleared
    explicitly, first, before the cascade delete below: DependencyEdge
    (has its own FKs to files.id that the cascade sorter doesn't know
    about) and Plan.reverts_action_id (a revert plan can point at an
    action belonging to a *different* plan of this same repo -- if that
    plan hasn't been deleted yet when its target action is, that's an FK
    violation the ORM's automatic ordering won't catch, since it only
    orders around declared relationships)."""
    repo = await session.get(Repository, repo_id, options=[selectinload(Repository.plans)])
    if repo is None:
        raise HTTPException(status_code=404, detail="repository not found")

    plan_ids = [p.id for p in repo.plans]
    local_path = repo.local_path

    # Never delete a plan out from under an in-flight execution (or start
    # executing one mid-delete) -- same per-plan lock run_ready_actions
    # holds (sprint 2 / audit H2).
    async with AsyncExitStack() as stack:
        for pid in sorted(plan_ids):
            await stack.enter_async_context(get_plan_lock(pid))

        await session.execute(update(Plan).where(Plan.repository_id == repo_id).values(reverts_action_id=None))
        await session.execute(delete(DependencyEdge).where(DependencyEdge.repository_id == repo_id))
        await session.delete(repo)
        await session.commit()

    # Filesystem cleanup happens after the DB commit succeeds.
    # ignore_errors=True: the repo is already gone from the app's
    # perspective at this point, which is the part that matters -- a
    # leftover directory (permission error, already gone, etc.) is just
    # wasted disk space, recoverable by hand, not worth failing the
    # request over.
    if local_path:
        await asyncio.to_thread(shutil.rmtree, Path(local_path), ignore_errors=True)
    for pid in plan_ids:
        await asyncio.to_thread(shutil.rmtree, Path(settings.plans_dir) / str(pid), ignore_errors=True)

    return Response(status_code=204)

    return Response(status_code=204)


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
        query_embedding = await asyncio.to_thread(embed_query, q)
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


@router.get("/{repo_id}/architecture", response_model=RepositoryDocResponse)
async def get_architecture(repo_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Generated on first view, then cached — see RepositoryDoc/architecture.py."""
    repo = await _get_repo_or_404(repo_id, session)

    existing = (
        await session.execute(select(RepositoryDoc).where(RepositoryDoc.repository_id == repo_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    try:
        doc = await generate_architecture_doc(session, repo)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"architecture generation failed: {exc}") from exc

    record = RepositoryDoc(
        repository_id=repo_id,
        readme_markdown=doc.readme_markdown,
        sequence_diagram_title=doc.sequence_diagram_title,
        sequence_diagram_mermaid=doc.sequence_diagram_mermaid,
        model=doc.model,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record
