"""The internal pipeline every adapter's POST /actions call runs through:
create -> risk score -> policy check -> auto-decide or queue for approval.
Every step is recorded in the append-only events table.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app import policy, risk
from app.db.models import Action, Event
from app.models.action import ActionObject

HIGH_RISK_REQUIRES_APPROVAL = "high"


async def _record_event(session: AsyncSession, action_id, event_type: str, payload: dict) -> None:
    session.add(Event(action_id=action_id, event_type=event_type, payload=payload))


async def submit_action(session: AsyncSession, action_in: ActionObject) -> Action:
    action = Action(
        action_type=action_in.action_type.value,
        target=action_in.target,
        actor_adapter=action_in.actor.adapter.value,
        actor_agent_name=action_in.actor.agent_name,
        actor_user=action_in.actor.user,
        environment=action_in.environment.value,
        branch=action_in.branch,
        action_metadata=action_in.metadata,
        status="pending",
    )
    session.add(action)
    await session.flush()  # assigns action.id

    await _record_event(session, action.id, "action_created", action_in.model_dump(mode="json"))

    risk_result = risk.score_action(action_in)
    action.risk_score = risk_result.score
    action.risk_level = risk_result.level
    await _record_event(
        session,
        action.id,
        "risk_scored",
        {"score": risk_result.score, "level": risk_result.level, "reasons": risk_result.reasons},
    )

    policy_result = await policy.evaluate(action_in)
    await _record_event(
        session,
        action.id,
        "policy_evaluated",
        {
            "allow": policy_result.allow,
            "require_approval": policy_result.require_approval,
            "deny_reasons": policy_result.deny_reasons,
            "approval_reasons": policy_result.approval_reasons,
        },
    )

    needs_approval = policy_result.require_approval or risk_result.level == HIGH_RISK_REQUIRES_APPROVAL

    if not policy_result.allow:
        action.status = "denied"
        await _record_event(
            session,
            action.id,
            "decided",
            {"decision": "denied", "by": "policy", "reasons": policy_result.deny_reasons},
        )
    elif needs_approval:
        reasons = policy_result.approval_reasons + (
            [f"risk level: {risk_result.level}"] if risk_result.level == HIGH_RISK_REQUIRES_APPROVAL else []
        )
        await _record_event(session, action.id, "approval_requested", {"reasons": reasons})
    else:
        action.status = "approved"
        await _record_event(session, action.id, "decided", {"decision": "approved", "by": "system"})

    await session.commit()
    await session.refresh(action)
    return action


async def decide_approval(
    session: AsyncSession, action: Action, approver: str, decision: str, reason: str | None
) -> Action:
    from app.db.models import Approval

    session.add(Approval(action_id=action.id, approver=approver, decision=decision, reason=reason))
    action.status = decision
    await _record_event(
        session,
        action.id,
        "approval_decided",
        {"approver": approver, "decision": decision, "reason": reason},
    )
    await session.commit()
    await session.refresh(action)
    return action
