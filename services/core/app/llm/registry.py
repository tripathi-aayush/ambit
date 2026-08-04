"""Factory for LLMClient implementations, selected by settings.llm_provider
(env var LLM_PROVIDER) or an explicit override. Business logic should call
get_llm_client() and never import a provider module directly."""

from app.config import settings
from app.llm.base import LLMClient


def get_llm_client(provider: str | None = None) -> LLMClient:
    name = (provider or settings.llm_provider).lower()

    if name == "groq":
        from app.llm.providers.groq_provider import GroqClient

        return GroqClient()
    if name == "anthropic":
        from app.llm.providers.anthropic_provider import AnthropicClient

        return AnthropicClient()
    if name == "openai":
        from app.llm.providers.openai_provider import OpenAIClient

        return OpenAIClient()
    if name == "gemini":
        from app.llm.providers.gemini_provider import GeminiClient

        return GeminiClient()

    raise ValueError(f"unknown LLM_PROVIDER: {name!r} (expected groq, anthropic, openai, or gemini)")
