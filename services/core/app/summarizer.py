"""LLM-generated per-file semantic summaries. Every summary is tagged
source="inferred" with a self-reported confidence score — per the plan's
"understands is a probabilistic LLM summary, not ground truth" caveat,
never presented as verified fact.

Provider-agnostic: goes through app.llm.get_llm_client(), selected by
LLM_PROVIDER (default groq — good rate limits for iterating on ingestion
during development). Never import a provider SDK directly here.
"""

from dataclasses import dataclass

from app.llm import get_llm_client
from app.llm.base import LLMRefusalError

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

    client = get_llm_client()

    try:
        data = await client.structured_completion(prompt, SUMMARY_SCHEMA, max_tokens=512)
    except LLMRefusalError:
        return FileSummaryResult(
            summary="Summary unavailable: model declined to summarize this file.",
            confidence=0.0,
            model=client.model_name,
        )

    return FileSummaryResult(
        summary=data["summary"],
        confidence=float(data["confidence"]),
        model=client.model_name,
    )
