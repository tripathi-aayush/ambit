"""LLM-generated per-file semantic summaries via Claude. Every summary is
tagged source="inferred" with a self-reported confidence score — per the
plan's "understands is a probabilistic LLM summary, not ground truth"
caveat, never presented as verified fact.
"""

import json
from dataclasses import dataclass

from anthropic import AsyncAnthropic

from app.config import settings

MODEL = "claude-opus-5"
MAX_CONTENT_CHARS = 8000  # keep per-file summarization cheap; truncate long files

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "1-3 sentence semantic summary of what this file does and why it exists.",
        },
        "confidence": {
            "type": "number",
            "description": "Self-assessed confidence (0.0-1.0) in the accuracy of this summary.",
        },
    },
    "required": ["summary", "confidence"],
    "additionalProperties": False,
}

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


@dataclass
class FileSummaryResult:
    summary: str
    confidence: float
    model: str


async def summarize_file(path: str, content: str) -> FileSummaryResult:
    truncated = content[:MAX_CONTENT_CHARS]
    truncation_note = "\n\n[... file truncated ...]" if len(content) > MAX_CONTENT_CHARS else ""

    prompt = (
        f"Summarize the purpose of this file for a codebase-intelligence tool. "
        f"Be specific about what it does, not generic.\n\n"
        f"File: {path}\n\n```\n{truncated}{truncation_note}\n```"
    )

    client = _get_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=512,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SUMMARY_SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )

    if response.stop_reason == "refusal":
        return FileSummaryResult(
            summary="Summary unavailable: model declined to summarize this file.",
            confidence=0.0,
            model=MODEL,
        )

    text = next((b.text for b in response.content if b.type == "text"), "{}")
    data = json.loads(text)
    return FileSummaryResult(
        summary=data["summary"],
        confidence=float(data["confidence"]),
        model=MODEL,
    )
