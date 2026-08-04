"""Chunk files for embedding: semantic chunks (one per top-level
function/class) for parseable code, fixed-size line windows for everything
else (docs, unparsed languages, and any code not covered by a symbol).
"""

from dataclasses import dataclass

from app.ingestion.languages import DOC_LANGUAGES, PARSEABLE_LANGUAGES
from app.ingestion.parser import SymbolResult

MAX_CHUNK_CHARS = 4000
FALLBACK_CHUNK_LINES = 60


@dataclass
class ChunkResult:
    content: str
    start_line: int | None
    end_line: int | None


def _fixed_line_windows(lines: list[str], window: int = FALLBACK_CHUNK_LINES) -> list[ChunkResult]:
    chunks = []
    for i in range(0, len(lines), window):
        window_lines = lines[i : i + window]
        content = "\n".join(window_lines).strip()
        if content:
            chunks.append(ChunkResult(content, i + 1, i + len(window_lines)))
    return chunks


def chunk_file(language: str | None, content: str, symbols: list[SymbolResult]) -> list[ChunkResult]:
    lines = content.splitlines()
    if not lines:
        return []

    if language not in PARSEABLE_LANGUAGES:
        return _fixed_line_windows(lines)

    top_level = [s for s in symbols if s.symbol_type in ("function", "class")]
    if not top_level:
        return _fixed_line_windows(lines)

    covered = set()
    chunks: list[ChunkResult] = []
    for symbol in top_level:
        symbol_lines = lines[symbol.start_line - 1 : symbol.end_line]
        text = "\n".join(symbol_lines).strip()
        if not text:
            continue
        if len(text) > MAX_CHUNK_CHARS:
            chunks.extend(_fixed_line_windows(symbol_lines))
        else:
            chunks.append(ChunkResult(text, symbol.start_line, symbol.end_line))
        covered.update(range(symbol.start_line, symbol.end_line + 1))

    leftover_lines = [line for i, line in enumerate(lines, start=1) if i not in covered]
    leftover_text = "\n".join(leftover_lines).strip()
    if len(leftover_text) > 20:  # skip near-empty leftovers (blank lines, stray braces)
        chunks.append(ChunkResult(leftover_text, None, None))

    return chunks
