import json
from typing import Any

from groq import AsyncGroq

from app.config import settings
from app.llm.base import LLMClient
from app.llm.schema_utils import append_schema_instructions

DEFAULT_MODEL = "llama-3.3-70b-versatile"


class GroqClient(LLMClient):
    def __init__(self, model: str = DEFAULT_MODEL):
        self.model_name = model
        self._client = AsyncGroq(api_key=settings.groq_api_key)

    async def structured_completion(self, prompt: str, schema: dict[str, Any], max_tokens: int) -> dict:
        response = await self._client.chat.completions.create(
            model=self.model_name,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": append_schema_instructions(prompt, schema)}],
        )
        return json.loads(response.choices[0].message.content)
