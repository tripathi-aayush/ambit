"""Orchestrates the Phase 2 ingestion pipeline: clone -> walk -> parse ->
dependency graph -> chunk + embed -> LLM summarize -> ownership -> persist.

Structural analysis (files, symbols, dependency graph, ownership) is
committed as its own transaction before the two steps that depend on paid,
rate-limited external APIs (Voyage embeddings, Claude summaries) run. A
failure in either of those degrades the repo to "ready with partial data"
rather than losing already-completed structural analysis — those two
providers can be rate-limited or unfunded independently of whether the
ingestion logic itself is correct.

Ingestion runs as a FastAPI background task: POST /repos creates the
Repository row (status="pending") and returns immediately; run_ingestion
does the heavy lifting in its own DB session and flips status to
"ready"/"failed" when done.
"""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Chunk,
    DependencyEdge,
    File,
    FileOwnership,
    FileSummary,
    RepoChunk,
    Repository,
    Symbol,
)
from app.db.session import async_session
from app.embeddings import embed_documents
from app.ingestion.chunking import chunk_file
from app.ingestion.commits import get_recent_commits
from app.ingestion.github_issues import fetch_issues_and_prs
from app.ingestion.graph import build_dependency_graph
from app.ingestion.languages import LOCKFILE_NAMES
from app.ingestion.ownership import compute_ownership
from app.ingestion.parser import parse_symbols
from app.ingestion.walker import WalkedFile, clone_for_ingestion, walk_repo
from app.summarizer import summarize_file

MAX_REPO_CHUNK_CHARS = 4000

SUMMARY_CONCURRENCY = 5


async def create_pending_repository(session: AsyncSession, clone_url: str) -> Repository:
    name = clone_url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git")
    repository = Repository(clone_url=clone_url, name=name, local_path="", status="pending")
    session.add(repository)
    await session.commit()
    await session.refresh(repository)
    return repository


async def _summarize_with_limit(sem: asyncio.Semaphore, path: str, content: str):
    async with sem:
        try:
            return path, await summarize_file(path, content)
        except Exception as exc:  # noqa: BLE001 - external LLM call, must not abort ingestion
            return path, exc


async def _persist_structure(
    session: AsyncSession,
    repo_id: uuid.UUID,
    walked_files: list[WalkedFile],
    symbols_by_path: dict[str, list],
    local_path,
) -> dict[str, uuid.UUID]:
    file_ids: dict[str, uuid.UUID] = {}
    file_rows: list[File] = []
    for wf in walked_files:
        fid = uuid.uuid4()
        file_ids[wf.path] = fid
        file_rows.append(
            File(
                id=fid,
                repository_id=repo_id,
                path=wf.path,
                language=wf.language,
                size_bytes=wf.size_bytes,
                content_hash=wf.content_hash,
            )
        )
    session.add_all(file_rows)
    await session.flush()  # files must exist before symbols/edges/chunks reference them

    for wf in walked_files:
        for symbol in symbols_by_path.get(wf.path, []):
            session.add(
                Symbol(
                    file_id=file_ids[wf.path],
                    symbol_type=symbol.symbol_type,
                    name=symbol.name,
                    detail=symbol.detail,
                    start_line=symbol.start_line,
                    end_line=symbol.end_line,
                )
            )

    graph = build_dependency_graph(walked_files, symbols_by_path)
    for source, target, data in graph.edges(data=True):
        if target.startswith("external:"):
            session.add(
                DependencyEdge(
                    repository_id=repo_id,
                    source_file_id=file_ids[source],
                    target_file_id=None,
                    target_external_name=target.removeprefix("external:"),
                    edge_type=data.get("edge_type", "import"),
                )
            )
        else:
            session.add(
                DependencyEdge(
                    repository_id=repo_id,
                    source_file_id=file_ids[source],
                    target_file_id=file_ids[target],
                    edge_type=data.get("edge_type", "import"),
                )
            )

    ownership = compute_ownership(local_path)
    for path, entries in ownership.items():
        if path not in file_ids:
            continue
        for entry in entries:
            session.add(
                FileOwnership(
                    file_id=file_ids[path],
                    author_name=entry.author_name,
                    author_email=entry.author_email,
                    commit_count=entry.commit_count,
                    last_commit_at=entry.last_commit_at,
                )
            )

    return file_ids


async def run_ingestion(repo_id: uuid.UUID) -> None:
    async with async_session() as session:
        repository = await session.get(Repository, repo_id)
        if repository is None:
            return

        try:
            local_path = clone_for_ingestion(repository.clone_url)
            repository.local_path = str(local_path)
            repository.status = "processing"
            await session.commit()

            walked_files, frameworks = walk_repo(local_path)

            symbols_by_path: dict[str, list] = {}
            for wf in walked_files:
                if wf.language in ("python", "javascript", "typescript"):
                    symbols_by_path[wf.path] = parse_symbols(wf.language, wf.content)

            file_ids = await _persist_structure(session, repo_id, walked_files, symbols_by_path, local_path)
            repository.frameworks = frameworks
            await session.commit()
        except Exception as exc:
            await session.rollback()
            repository.status = "failed"
            repository.error = f"structural analysis failed: {exc}"[:2000]
            await session.commit()
            return

        degraded_notes: list[str] = []

        try:
            chunk_texts: list[str] = []
            chunk_meta: list[tuple[str, int, int | None, int | None]] = []
            for wf in walked_files:
                if wf.path.rsplit("/", 1)[-1] in LOCKFILE_NAMES:
                    continue
                chunks = chunk_file(wf.language, wf.content, symbols_by_path.get(wf.path, []))
                for idx, chunk in enumerate(chunks):
                    chunk_texts.append(chunk.content)
                    chunk_meta.append((wf.path, idx, chunk.start_line, chunk.end_line))

            embeddings = await asyncio.to_thread(embed_documents, chunk_texts) if chunk_texts else []
            for (path, idx, start, end), text, embedding in zip(chunk_meta, chunk_texts, embeddings):
                session.add(
                    Chunk(
                        file_id=file_ids[path],
                        chunk_index=idx,
                        content=text,
                        start_line=start,
                        end_line=end,
                        embedding=embedding,
                    )
                )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            degraded_notes.append(f"chunk/embed failed: {exc}")

        try:
            repo_chunk_rows: list[tuple[str, str, str, str, str | None]] = []  # type, id, title, content, url

            for commit in get_recent_commits(local_path):
                content = f"{commit.subject}\n\n{commit.body}".strip()[:MAX_REPO_CHUNK_CHARS]
                repo_chunk_rows.append(("commit", commit.sha, commit.subject, content, None))

            for entry in await fetch_issues_and_prs(repository.clone_url):
                content = f"{entry.title}\n\n{entry.body}".strip()[:MAX_REPO_CHUNK_CHARS]
                repo_chunk_rows.append(
                    (entry.source_type, str(entry.number), entry.title, content, entry.url)
                )

            texts = [row[3] for row in repo_chunk_rows]
            repo_embeddings = await asyncio.to_thread(embed_documents, texts) if texts else []
            for (source_type, source_id, title, content, url), embedding in zip(
                repo_chunk_rows, repo_embeddings
            ):
                session.add(
                    RepoChunk(
                        repository_id=repo_id,
                        source_type=source_type,
                        source_id=source_id,
                        title=title,
                        content=content,
                        url=url,
                        embedding=embedding,
                    )
                )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            degraded_notes.append(f"commit/PR/issue ingestion failed: {exc}")

        try:
            sem = asyncio.Semaphore(SUMMARY_CONCURRENCY)
            summary_tasks = [
                _summarize_with_limit(sem, wf.path, wf.content)
                for wf in walked_files
                if wf.language is not None and wf.path.rsplit("/", 1)[-1] not in LOCKFILE_NAMES
            ]
            failures = 0
            for path, outcome in await asyncio.gather(*summary_tasks):
                if isinstance(outcome, Exception):
                    failures += 1
                    continue
                session.add(
                    FileSummary(
                        file_id=file_ids[path],
                        summary_text=outcome.summary,
                        confidence=outcome.confidence,
                        model=outcome.model,
                        source="inferred",
                    )
                )
            if failures and failures == len(summary_tasks):
                degraded_notes.append("all file summaries failed (see server logs)")
            await session.commit()
        except Exception as exc:
            await session.rollback()
            degraded_notes.append(f"summarization failed: {exc}")

        repository.status = "ready"
        repository.error = "; ".join(degraded_notes)[:2000] if degraded_notes else None
        await session.commit()
