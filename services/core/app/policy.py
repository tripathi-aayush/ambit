"""Thin client wrapping the OPA sidecar. Orion does not implement its own
policy engine — Rego rules live in infra/opa/policies/orion.rego."""

from dataclasses import dataclass, field

import httpx

from app.config import settings
from app.models.action import ActionObject

OPA_QUERY_PATH = "/v1/data/orion"


@dataclass
class PolicyResult:
    allow: bool
    require_approval: bool
    deny_reasons: list[str] = field(default_factory=list)
    approval_reasons: list[str] = field(default_factory=list)


async def evaluate(action: ActionObject) -> PolicyResult:
    # Sprint 1 / audit C4: OPA being unreachable (down, network blip,
    # timeout) used to propagate as an unhandled httpx exception -- an
    # accidental 500 for every action submission, not a decision. That's
    # closer to fail-closed than fail-open by accident (nothing gets
    # silently allowed), but it's still not an intentional choice. Made
    # explicit here: no policy decision available -> deny, don't guess.
    payload = action.model_dump(mode="json")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.opa_url}{OPA_QUERY_PATH}",
                json={"input": payload},
                timeout=5.0,
            )
            resp.raise_for_status()
            result = resp.json().get("result", {})
    except httpx.HTTPError as exc:
        return PolicyResult(
            allow=False,
            require_approval=False,
            deny_reasons=[f"policy engine unavailable, denying by default: {exc}"],
        )

    return PolicyResult(
        # OPA's own Rego defaults (`default allow := true` /
        # `default require_approval := false`) guarantee these keys are
        # present in any well-formed response, so these Python-side
        # fallbacks should rarely if ever trigger in practice -- but if
        # OPA ever returns an unexpected/incomplete shape, fail closed
        # (deny, require approval) rather than the reverse.
        allow=result.get("allow", False),
        require_approval=result.get("require_approval", True),
        deny_reasons=result.get("deny_reasons", []),
        approval_reasons=result.get("approval_reasons", []),
    )
