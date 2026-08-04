"""Builds an in-memory NetworkX dependency graph from import symbols,
best-effort resolving each import to a file within the repo. Unresolved
imports (external packages) become edges to a synthetic external node
(no target_file_id, just target_external_name).
"""

import networkx as nx

from app.ingestion.parser import SymbolResult
from app.ingestion.walker import WalkedFile


def _python_module_to_candidates(module: str) -> list[str]:
    parts = module.split(".")
    base = "/".join(parts)
    return [f"{base}.py", f"{base}/__init__.py"]


def _match_by_suffix(candidate: str, known_paths: set[str]) -> str | None:
    """Monorepos put the Python package root under a subdirectory (e.g.
    services/core/app/...), so an import like `app.db.models` won't equal
    any known path exactly — match by path suffix instead. Prefers the
    shortest (closest) match when multiple package roots could apply."""
    matches = sorted(
        (p for p in known_paths if p == candidate or p.endswith("/" + candidate)),
        key=len,
    )
    return matches[0] if matches else None


def _js_relative_to_candidates(source_file: str, target: str) -> list[str]:
    from posixpath import normpath, dirname, join

    base = normpath(join(dirname(source_file), target))
    return [
        # The import may already include its extension (`./App.tsx`,
        # `./index.css`) — check the base path as-is before assuming one
        # needs to be appended, otherwise this builds nonsense candidates
        # like `src/App.tsx.ts`.
        base,
        f"{base}.ts", f"{base}.tsx", f"{base}.js", f"{base}.jsx",
        f"{base}/index.ts", f"{base}/index.tsx", f"{base}/index.js",
    ]


def build_dependency_graph(
    files: list[WalkedFile], symbols_by_path: dict[str, list[SymbolResult]]
) -> nx.DiGraph:
    graph = nx.DiGraph()
    known_paths = {f.path for f in files}
    for f in files:
        graph.add_node(f.path, language=f.language)

    for f in files:
        for symbol in symbols_by_path.get(f.path, []):
            if symbol.symbol_type != "import" or not symbol.detail:
                continue

            resolved: str | None = None
            for module in symbol.detail.split(","):
                module = module.strip()
                if not module:
                    continue

                if f.language == "python":
                    candidates = _python_module_to_candidates(module)
                elif f.language in ("javascript", "typescript") and module.startswith("."):
                    candidates = _js_relative_to_candidates(f.path, module)
                else:
                    candidates = []

                match = next((c for c in candidates if c in known_paths), None)
                if not match and f.language == "python":
                    match = next(
                        (m for c in candidates if (m := _match_by_suffix(c, known_paths))), None
                    )
                if match:
                    resolved = match
                    break

            if resolved:
                graph.add_edge(f.path, resolved, edge_type="import")
            else:
                external_name = symbol.detail.split(",")[0].strip()
                external_node = f"external:{external_name}"
                graph.add_node(external_node, external=True)
                graph.add_edge(f.path, external_node, edge_type="import")

    return graph
