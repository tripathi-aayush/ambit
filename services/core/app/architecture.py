"""Phase 4: LLM-generated architecture README + one sequence diagram.

Both are synthesized from data Phase 2/3 already extracted (file
summaries, dependency graph, detected routes) — no new parsing here.
Generated on-demand and cached in RepositoryDoc; always tagged
source="inferred", per the plan's "AI-generated, verify before use"
requirement — these are readable, plausible syntheses, not verified fact.
"""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chunk, DependencyEdge, File, FileSummary, Repository, Symbol
from app.llm import get_llm_client

MAX_SUMMARIES_IN_PROMPT = 60
MAX_DEPENDENCY_FILES = 3

SEQUENCE_DIAGRAM_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short title for the traced path, e.g. 'POST /actions request path'."},
        "mermaid": {
            "type": "string",
            "description": "A Mermaid sequenceDiagram block (starting with 'sequenceDiagram'), tracing this handler's call flow through its immediate dependencies.",
        },
    },
    "required": ["title", "mermaid"],
    "additionalProperties": False,
}


@dataclass
class ArchitectureDoc:
    readme_markdown: str
    sequence_diagram_title: str
    sequence_diagram_mermaid: str
    model: str


async def _gather_readme_context(session: AsyncSession, repo: Repository) -> str:
    result = await session.execute(
        select(File.path, FileSummary.summary_text)
        .join(FileSummary, FileSummary.file_id == File.id)
        .where(File.repository_id == repo.id)
        .order_by(File.path)
        .limit(MAX_SUMMARIES_IN_PROMPT)
    )
    summaries = result.all()

    edge_count = (
        await session.execute(
            select(DependencyEdge).where(
                DependencyEdge.repository_id == repo.id, DependencyEdge.target_file_id.is_not(None)
            )
        )
    ).all()

    lines = [
        f"Repository: {repo.name}",
        f"Detected frameworks: {', '.join(repo.frameworks) or 'none detected'}",
        f"Internal dependency edges: {len(edge_count)}",
        "",
        "Per-file summaries (auto-generated, may be incomplete):",
    ]
    for path, summary in summaries:
        lines.append(f"- {path}: {summary}")

    return "\n".join(lines)


async def generate_readme(session: AsyncSession, repo: Repository) -> tuple[str, str]:
    context = await _gather_readme_context(session, repo)
    prompt = (
        "Write a concise architecture README (Markdown) for this repository, based only on the "
        "information below. Cover: what the project does, its main components/modules and how they "
        "relate, and the tech stack. Do not invent details not supported by the summaries. Keep it "
        "under 500 words. Use ATX-style headers (# and ##) only — never add a row of underline "
        "characters (e.g. ===== or -----) beneath a heading.\n\n" + context
    )
    client = get_llm_client()
    markdown = await client.complete(prompt, max_tokens=1200)
    return markdown, client.model_name


TRIVIAL_ROUTE_HINTS = ("health", "ping", "/ ", "root", "readiness", "liveness")


async def _pick_sequence_target(session: AsyncSession, repo_id) -> Symbol | None:
    """Prefers routes with richer call graphs over trivial ones — the
    first route found is often a /health check, which traces to nothing
    interesting. Ranks by the route's file's outgoing dependency-edge
    count (a proxy for "this handler actually does something"), and
    deprioritizes (not excludes) obviously trivial names."""
    routes = (
        await session.execute(
            select(Symbol)
            .join(File, File.id == Symbol.file_id)
            .where(File.repository_id == repo_id, Symbol.symbol_type == "route")
        )
    ).scalars().all()

    if routes:
        edge_counts = dict(
            (
                await session.execute(
                    select(DependencyEdge.source_file_id, func.count())
                    .where(
                        DependencyEdge.repository_id == repo_id,
                        DependencyEdge.target_file_id.is_not(None),
                    )
                    .group_by(DependencyEdge.source_file_id)
                )
            ).all()
        )

        def score(route: Symbol) -> tuple[int, int]:
            is_trivial = any(hint in route.name.lower() for hint in TRIVIAL_ROUTE_HINTS)
            return (0 if is_trivial else 1, edge_counts.get(route.file_id, 0))

        return max(routes, key=score)

    return (
        await session.execute(
            select(Symbol)
            .join(File, File.id == Symbol.file_id)
            .where(File.repository_id == repo_id, Symbol.symbol_type == "function")
            .limit(1)
        )
    ).scalar_one_or_none()


async def _gather_sequence_context(session: AsyncSession, repo_id, target: Symbol) -> str:
    target_file = await session.get(File, target.file_id)

    own_chunks = (
        await session.execute(
            select(Chunk.content).where(Chunk.file_id == target.file_id).order_by(Chunk.chunk_index)
        )
    ).scalars().all()

    dep_rows = (
        await session.execute(
            select(File.path, Chunk.content)
            .join(DependencyEdge, DependencyEdge.target_file_id == File.id)
            .join(Chunk, Chunk.file_id == File.id)
            .where(DependencyEdge.source_file_id == target.file_id, DependencyEdge.repository_id == repo_id)
            .limit(MAX_DEPENDENCY_FILES)
        )
    ).all()

    lines = [
        f"Target: {target.symbol_type} `{target.name}` in {target_file.path if target_file else '?'}",
        "",
        "Target source:",
        "\n".join(own_chunks)[:4000],
    ]
    if dep_rows:
        lines.append("\nDirect dependencies (may only show a fragment):")
        for path, content in dep_rows:
            lines.append(f"\n--- {path} ---\n{content[:1500]}")

    return "\n".join(lines)


async def generate_sequence_diagram(session: AsyncSession, repo: Repository) -> tuple[str, str, str]:
    target = await _pick_sequence_target(session, repo.id)
    if target is None:
        return (
            "No traceable path found",
            "sequenceDiagram\n    Note over System: No function or route was found to trace.",
            "none",
        )

    context = await _gather_sequence_context(session, repo.id, target)
    prompt = (
        "Trace the call flow below into a Mermaid sequence diagram. Base it only on the code shown — "
        "if a dependency's internals aren't shown, represent it as a single call/response rather than "
        "guessing its internals.\n\n" + context
    )
    client = get_llm_client()
    data = await client.structured_completion(prompt, SEQUENCE_DIAGRAM_SCHEMA, max_tokens=1000)
    return data["title"], data["mermaid"], client.model_name


async def generate_architecture_doc(session: AsyncSession, repo: Repository) -> ArchitectureDoc:
    readme, readme_model = await generate_readme(session, repo)
    seq_title, seq_mermaid, seq_model = await generate_sequence_diagram(session, repo)
    return ArchitectureDoc(
        readme_markdown=readme,
        sequence_diagram_title=seq_title,
        sequence_diagram_mermaid=seq_mermaid,
        model=readme_model if readme_model == seq_model else f"{readme_model}, {seq_model}",
    )
