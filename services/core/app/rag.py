"""RAG retrieval + answer generation for Repository Chat: unified
cosine-distance search over code chunks and repo-level chunks (commits,
PRs, issues), then a grounded answer from the configured LLM provider.

The "not enough information" fallback is retrieval-based, not
LLM-self-reported: if nothing clears NOT_ENOUGH_INFO_DISTANCE, the LLM is
never called — more reliable than trusting a model to admit uncertainty,
and cheaper.
"""

import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chunk, File, RepoChunk
from app.embeddings import embed_query
from app.llm import get_llm_client
from app.llm.base import LLMRefusalError

TOP_K = 8
# Cosine distance is 0 (identical) to 2 (opposite); ~1 is unrelated.
#
# Calibrated against a real repo (not synthetic): specific, well-matched
# questions ("how does risk scoring work") land at 0.31-0.47. Broad-but-
# legitimate questions ("what tech stack is used", "what else do you know
# about this repo") land at 0.62-0.76. Truly unrelated questions ("capital
# of France", "recipe for tiramisu") land at 0.74-0.80. Those two ranges
# overlap — there is no fixed distance that cleanly separates "broad but
# real" from "unrelated" on this data, full stop. So this threshold is
# deliberately loose: its only job is rejecting queries with nothing even
# tangentially relevant indexed (very high distance). Distinguishing "weak
# match" from "actually irrelevant" is left to the model, which can read
# the content rather than just its embedding distance — the prompt (see
# _build_prompt) explicitly instructs it to say so when the sources don't
# answer the question. A wrong "here's my best guess" from the model is
# recoverable (the sources are shown, so it's checkable); a wrong "not
# enough information" when the answer was sitting right there is not — the
# threshold errs toward the recoverable failure mode.
NOT_ENOUGH_INFO_DISTANCE = 0.85

NOT_ENOUGH_INFO_MESSAGE = (
    "I don't have enough indexed information about this repository to answer that "
    "confidently. Try rephrasing, or ask about something covered by the repo's code, "
    "commit history, or issues/PRs."
)


@dataclass
class SourceHit:
    kind: str  # "code" | "commit" | "pr" | "issue"
    label: str
    content: str
    url: str | None
    distance: float


async def retrieve(session: AsyncSession, repo_id: uuid.UUID, query: str, top_k: int = TOP_K) -> list[SourceHit]:
    query_embedding = await asyncio.to_thread(embed_query, query)

    code_distance = Chunk.embedding.cosine_distance(query_embedding).label("distance")
    code_stmt = (
        select(File.path, Chunk.content, Chunk.start_line, Chunk.end_line, code_distance)
        .join(File, File.id == Chunk.file_id)
        .where(File.repository_id == repo_id, Chunk.embedding.is_not(None))
        .order_by(code_distance)
        .limit(top_k)
    )
    code_rows = (await session.execute(code_stmt)).all()

    hits: list[SourceHit] = []
    for row in code_rows:
        lines = f":{row.start_line}-{row.end_line}" if row.start_line else ""
        hits.append(
            SourceHit(kind="code", label=f"{row.path}{lines}", content=row.content, url=None, distance=row.distance)
        )

    repo_distance = RepoChunk.embedding.cosine_distance(query_embedding).label("distance")
    repo_stmt = (
        select(RepoChunk.source_type, RepoChunk.source_id, RepoChunk.title, RepoChunk.content, RepoChunk.url, repo_distance)
        .where(RepoChunk.repository_id == repo_id, RepoChunk.embedding.is_not(None))
        .order_by(repo_distance)
        .limit(top_k)
    )
    repo_rows = (await session.execute(repo_stmt)).all()

    for row in repo_rows:
        # kind is rendered as its own label by callers (e.g. the frontend's
        # KIND_LABELS) — don't repeat it here, just the identifying bit.
        if row.source_type == "commit":
            label = f"{row.source_id[:8]}: {row.title}"
        else:
            label = f"#{row.source_id}: {row.title}"
        hits.append(SourceHit(kind=row.source_type, label=label, content=row.content, url=row.url, distance=row.distance))

    hits.sort(key=lambda h: h.distance)
    return hits[:top_k]


def _build_prompt(question: str, history: list[tuple[str, str]], sources: list[SourceHit]) -> str:
    source_blocks = "\n\n".join(
        f"[{i + 1}] ({hit.kind}) {hit.label}\n{hit.content[:1500]}" for i, hit in enumerate(sources)
    )
    history_block = "\n".join(f"{role}: {content}" for role, content in history) if history else "(none)"

    return (
        "You are a codebase assistant answering questions about a specific repository. "
        "Answer ONLY using the numbered sources below — do not use outside knowledge about "
        "similarly-named projects or libraries. Cite sources inline using [1], [2], etc.\n\n"
        "The sources were found by similarity search and were not filtered for relevance — "
        "some may be weak or unrelated matches. Judge relevance yourself: if a source doesn't "
        "actually bear on the question, ignore it and don't cite it. If NONE of the sources "
        "answer the question, say plainly that the indexed repository doesn't cover it — don't "
        "guess or pad out an answer from unrelated sources. If the sources partially answer it, "
        "answer what you can and say what's missing, rather than declining entirely.\n\n"
        f"Conversation so far:\n{history_block}\n\n"
        f"Sources:\n{source_blocks}\n\n"
        f"Question: {question}\n\nAnswer:"
    )


async def answer_question(
    session: AsyncSession, repo_id: uuid.UUID, question: str, history: list[tuple[str, str]]
) -> tuple[str, list[SourceHit]]:
    sources = await retrieve(session, repo_id, question)

    if not sources or sources[0].distance > NOT_ENOUGH_INFO_DISTANCE:
        return NOT_ENOUGH_INFO_MESSAGE, []

    prompt = _build_prompt(question, history, sources)
    client = get_llm_client()
    try:
        answer = await client.complete(prompt, max_tokens=800)
    except LLMRefusalError:
        answer = "I'm not able to answer that one."

    return answer, sources
