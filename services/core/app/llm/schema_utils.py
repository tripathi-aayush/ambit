"""Shared helper for providers that get JSON out via prompt instructions +
basic JSON mode rather than a native schema-constrained decoding feature."""

import json


def append_schema_instructions(prompt: str, schema: dict) -> str:
    return (
        f"{prompt}\n\n"
        f"Respond with only a single valid JSON object matching this schema — "
        f"no other text, no markdown code fences:\n{json.dumps(schema)}"
    )
