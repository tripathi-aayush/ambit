"""Provider-agnostic LLM interface. Business logic (e.g. app.summarizer)
must only ever depend on this, never on a specific provider's SDK."""

from abc import ABC, abstractmethod
from typing import Any


class LLMRefusalError(Exception):
    """Raised when the provider's own safety/policy layer declines to
    answer. Distinct from network/auth/rate-limit errors so callers can
    treat a refusal as a (rare, expected) outcome rather than a failure."""


class LLMClient(ABC):
    """A client that can produce output conforming to a given JSON schema.

    Implementations are responsible for getting valid, schema-conforming
    JSON out of their own provider by whatever mechanism that provider
    supports (native structured outputs, JSON mode, or prompt + manual
    parse) — callers only see the parsed dict.
    """

    model_name: str

    @abstractmethod
    async def structured_completion(self, prompt: str, schema: dict[str, Any], max_tokens: int) -> dict:
        """Returns a dict that satisfies `schema` (an object schema with
        "properties" and "required", as used elsewhere in this codebase)."""
        raise NotImplementedError
