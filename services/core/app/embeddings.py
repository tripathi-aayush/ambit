"""Thin wrapper around Voyage AI — Anthropic's recommended embeddings
partner (Claude itself has no embeddings endpoint).

An unfunded account caps at 3 requests/minute AND 10K tokens/minute;
a funded one does not hit either in normal use. Batches are built to
respect the token cap regardless (not just a fixed chunk count) —
retrying the same oversized batch after a 429 does nothing, since it's
the same too-large request every time — but there's no blanket delay
between batches. Pacing is purely reactive (retry-after-429), so a
funded account ingests at full speed and an unfunded one still degrades
gracefully instead of hammering a wall.

Retrying does NOT help every failure, though: a single lockfile chunk
(uv.lock, package-lock.json, ...) can be large enough on its own to blow
a per-request token cap even though the rest of its batch was well
within budget — lockfile lines (hashes, URLs, no whitespace) tokenize
far denser than code or English, so a chunk that looks fine by character
count can still be rejected outright. That's a genuinely different
failure (request too large, not too frequent) and Voyage raises it as a
different error than RateLimitError — retrying it would never succeed,
so it isn't retried here. The actual fix for that case lives in
app.ingestion.languages.LOCKFILE_NAMES: lockfiles are excluded from
chunking entirely (see app.ingestion.pipeline), since they have zero
semantic value for chat anyway.

Two retry/pacing budgets: embed_documents runs inside the background
ingestion task, where nobody is blocked on an HTTP response, so it can
afford to pace itself and retry generously. embed_query runs inside a
live chat/search request with a user waiting on it, so it gets a much
shorter retry budget — a slow failure is better than making someone
stare at "Thinking…" for minutes.
"""

import logging

import voyageai
from tenacity import before_sleep_log, retry, retry_if_exception_type, stop_after_attempt, wait_fixed

from app.config import settings

logger = logging.getLogger("ambit.embeddings")

MODEL = "voyage-3"
MAX_BATCH_ITEMS = 128
MAX_BATCH_TOKENS = 8000  # headroom under the unfunded tier's 10K TPM cap
CHARS_PER_TOKEN_ESTIMATE = 4  # rough heuristic, not a real tokenizer — good enough for batch sizing
RATE_LIMIT_RETRY_WAIT_SECONDS = 21  # just over the unfunded tier's 3-requests-per-minute window

_client: voyageai.Client | None = None


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


def _embed(texts: list[str], input_type: str) -> list[list[float]]:
    client = _get_client()
    result = client.embed(texts, model=MODEL, input_type=input_type)
    return result.embeddings


_retry_kwargs = dict(
    retry=retry_if_exception_type(voyageai.error.RateLimitError),
    wait=wait_fixed(RATE_LIMIT_RETRY_WAIT_SECONDS),
    reraise=True,
    before_sleep=before_sleep_log(logger, logging.INFO),
)

_embed_batch_background = retry(stop=stop_after_attempt(4), **_retry_kwargs)(_embed)
_embed_batch_foreground = retry(stop=stop_after_attempt(2), **_retry_kwargs)(_embed)


def _token_aware_batches(texts: list[str]) -> list[list[str]]:
    """Splits on both item count and an estimated token budget — a batch
    of 128 short chunks and a batch of 20 huge ones can both blow the
    10K TPM cap if only chunk count is considered."""
    batches: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0

    for text in texts:
        text_tokens = max(1, len(text) // CHARS_PER_TOKEN_ESTIMATE)
        would_overflow = current and (
            current_tokens + text_tokens > MAX_BATCH_TOKENS or len(current) >= MAX_BATCH_ITEMS
        )
        if would_overflow:
            batches.append(current)
            current = []
            current_tokens = 0
        current.append(text)
        current_tokens += text_tokens

    if current:
        batches.append(current)
    return batches


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Background ingestion path. Blocking (network, pacing delays,
    possible retry sleeps) — call via asyncio.to_thread from async code."""
    if not texts:
        return []
    embeddings: list[list[float]] = []
    batches = _token_aware_batches(texts)
    logger.info("embed_documents: %d texts -> %d batches", len(texts), len(batches))
    for batch in batches:
        embeddings.extend(_embed_batch_background(batch, "document"))
    return embeddings


def embed_query(text: str) -> list[float]:
    """Live request path (chat/search) — only 2 attempts (~21s worst
    case) since a user is waiting on this synchronously. Blocking; call
    via asyncio.to_thread from async code."""
    return _embed_batch_foreground([text], "query")[0]
