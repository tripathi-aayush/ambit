import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Chunk, DependencyEdge, File, Repository
from app.db.session import get_session
from app.embeddings import embed_query
from app.ingestion.pipeline import create_pending_repository, run_ingestion
from app.schemas import (
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
    """Proves the pgvector retrieval pipeline works: embeds the query with
    Voyage AI and does a cosine-distance nearest-neighbor search over the
    repo's chunks. The RAG chat pipeline itself is Phase 3 scope."""
    await _get_repo_or_404(repo_id, session)
    query_embedding = embed_query(q)

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
