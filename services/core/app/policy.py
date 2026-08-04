"""Thin client wrapping the OPA sidecar. Ambit does not implement its own
policy engine — Rego rules live in infra/opa/policies/ambit.rego."""

from dataclasses import dataclass, field

import httpx

from app.config import settings
from app.models.action import ActionObject

OPA_QUERY_PATH = "/v1/data/ambit"


@dataclass
class PolicyResult:
    allow: bool
    require_approval: bool
    deny_reasons: list[str] = field(default_factory=list)
    approval_reasons: list[str] = field(default_factory=list)


async def evaluate(action: ActionObject) -> PolicyResult:
    payload = action.model_dump(mode="json")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.opa_url}{OPA_QUERY_PATH}",
            json={"input": payload},
            timeout=5.0,
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})

    return PolicyResult(
        allow=result.get("allow", True),
        require_approval=result.get("require_approval", False),
        deny_reasons=result.get("deny_reasons", []),
        approval_reasons=result.get("approval_reasons", []),
    )
