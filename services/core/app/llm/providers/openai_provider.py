import json
from typing import Any

from openai import AsyncOpenAI

from app.config import settings
from app.llm.base import LLMClient
from app.llm.schema_utils import append_schema_instructions

DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIClient(LLMClient):
    def __init__(self, model: str = DEFAULT_MODEL):
        self.model_name = model
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def structured_completion(self, prompt: str, schema: dict[str, Any], max_tokens: int) -> dict:
        response = await self._client.chat.completions.create(
            model=self.model_name,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": append_schema_instructions(prompt, schema)}],
        )
        return json.loads(response.choices[0].message.content)

    async def complete(self, prompt: str, max_tokens: int) -> str:
        response = await self._client.chat.completions.create(
            model=self.model_name,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content or ""
