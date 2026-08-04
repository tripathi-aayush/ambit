import json
from typing import Any

from anthropic import AsyncAnthropic

from app.config import settings
from app.llm.base import LLMClient, LLMRefusalError

DEFAULT_MODEL = "claude-opus-5"


class AnthropicClient(LLMClient):
    def __init__(self, model: str = DEFAULT_MODEL):
        self.model_name = model
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def structured_completion(self, prompt: str, schema: dict[str, Any], max_tokens: int) -> dict:
        response = await self._client.messages.create(
            model=self.model_name,
            max_tokens=max_tokens,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": prompt}],
        )

        if response.stop_reason == "refusal":
            raise LLMRefusalError(f"{self.model_name} declined to respond")

        text = next((b.text for b in response.content if b.type == "text"), "{}")
        return json.loads(text)

    async def complete(self, prompt: str, max_tokens: int) -> str:
        response = await self._client.messages.create(
            model=self.model_name,
            max_tokens=max_tokens,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        )

        if response.stop_reason == "refusal":
            raise LLMRefusalError(f"{self.model_name} declined to respond")

        return next((b.text for b in response.content if b.type == "text"), "")
