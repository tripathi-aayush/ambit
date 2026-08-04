import json
from typing import Any

from google import genai
from google.genai import types

from app.config import settings
from app.llm.base import LLMClient

DEFAULT_MODEL = "gemini-2.0-flash"


class GeminiClient(LLMClient):
    def __init__(self, model: str = DEFAULT_MODEL):
        self.model_name = model
        self._client = genai.Client(api_key=settings.gemini_api_key)

    async def structured_completion(self, prompt: str, schema: dict[str, Any], max_tokens: int) -> dict:
        response = await self._client.aio.models.generate_content(
            model=self.model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                max_output_tokens=max_tokens,
            ),
        )
        return response.parsed if response.parsed is not None else json.loads(response.text)
