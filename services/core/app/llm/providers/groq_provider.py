"""Groq provider with multi-key failover: when one key hits its rate limit
(observed in practice — Groq's free tier is 100K tokens/day, and this
account's own testing volume alone exhausted it repeatedly), the client
tries the next configured key rather than failing the request. Keys are
configured via GROQ_API_KEY + GROQ_API_KEYS_EXTRA (comma-separated) — see
app.config.Settings.groq_api_keys.

State is module-level (not per-GroqClient) because a new GroqClient is
constructed on every call to get_llm_client() — without sharing the
"last known good key" across instances, every single request would
retry the same already-exhausted key first before finding a working one.
"""

import json
from typing import Any

from groq import AsyncGroq, RateLimitError

from app.config import settings
from app.llm.base import LLMClient
from app.llm.schema_utils import append_schema_instructions

DEFAULT_MODEL = "llama-3.3-70b-versatile"

_current_key_index = 0


class GroqClient(LLMClient):
    def __init__(self, model: str = DEFAULT_MODEL):
        self.model_name = model
        keys = settings.groq_api_keys
        if not keys:
            keys = [""]  # let AsyncGroq raise its own clear "missing key" error
        self._clients = [AsyncGroq(api_key=k) for k in keys]

    async def _call_with_failover(self, fn):
        global _current_key_index
        last_exc: Exception | None = None
        for offset in range(len(self._clients)):
            idx = (_current_key_index + offset) % len(self._clients)
            try:
                result = await fn(self._clients[idx])
            except RateLimitError as exc:
                last_exc = exc
                continue
            _current_key_index = idx  # stick with the key that worked
            return result
        raise last_exc

    async def structured_completion(self, prompt: str, schema: dict[str, Any], max_tokens: int) -> dict:
        async def call(client: AsyncGroq):
            response = await client.chat.completions.create(
                model=self.model_name,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": append_schema_instructions(prompt, schema)}],
            )
            return response.choices[0].message.content

        text = await self._call_with_failover(call)
        return json.loads(text)

    async def complete(self, prompt: str, max_tokens: int) -> str:
        async def call(client: AsyncGroq):
            response = await client.chat.completions.create(
                model=self.model_name,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.choices[0].message.content or ""

        return await self._call_with_failover(call)
