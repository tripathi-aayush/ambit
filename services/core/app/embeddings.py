"""Thin wrapper around Voyage AI — Anthropic's recommended embeddings
partner (Claude itself has no embeddings endpoint)."""

import voyageai

from app.config import settings

MODEL = "voyage-3"
BATCH_SIZE = 128

_client: voyageai.Client | None = None


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


def embed_documents(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    client = _get_client()
    embeddings: list[list[float]] = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        result = client.embed(batch, model=MODEL, input_type="document")
        embeddings.extend(result.embeddings)
    return embeddings


def embed_query(text: str) -> list[float]:
    client = _get_client()
    result = client.embed([text], model=MODEL, input_type="query")
    return result.embeddings[0]
