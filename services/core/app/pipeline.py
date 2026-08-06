"""The internal pipeline every adapter's POST /actions call runs through:
create -> risk score -> policy check -> auto-decide or queue for approval.
Every step is recorded in the append-only events table.
"""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app import policy, risk
from app.db.models import Action, Event
from app.models.action import ActionObject

HIGH_RISK_REQUIRES_APPROVAL = "high"


async def record_event(session: AsyncSession, action_id, event_type: str, payload: dict) -> Event:
    event = Event(action_id=action_id, event_type=event_type, payload=payload)
    session.add(event)
    return event


async def submit_action(session: AsyncSession, action_in: ActionObject) -> tuple[Action, list[Event]]:
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

    events: list[Event] = []
    events.append(await record_event(session, action.id, "action_created", action_in.model_dump(mode="json")))

    risk_result = risk.score_action(action_in)
    action.risk_score = risk_result.score
    action.risk_level = risk_result.level
    events.append(
        await record_event(
            session,
            action.id,
            "risk_scored",
            {"score": risk_result.score, "level": risk_result.level, "reasons": risk_result.reasons},
        )
    )

    policy_result = await policy.evaluate(action_in)
    events.append(
        await record_event(
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
    )

    needs_approval = policy_result.require_approval or risk_result.level == HIGH_RISK_REQUIRES_APPROVAL

    if not policy_result.allow:
        action.status = "denied"
        events.append(
            await record_event(
                session,
                action.id,
                "decided",
                {"decision": "denied", "by": "policy", "reasons": policy_result.deny_reasons},
            )
        )
    elif needs_approval:
        reasons = policy_result.approval_reasons + (
            [f"risk level: {risk_result.level}"] if risk_result.level == HIGH_RISK_REQUIRES_APPROVAL else []
        )
        events.append(await record_event(session, action.id, "approval_requested", {"reasons": reasons}))
    else:
        action.status = "approved"
        events.append(await record_event(session, action.id, "decided", {"decision": "approved", "by": "system"}))

    await session.commit()
    await session.refresh(action)
    return action, events


async def decide_approval(
    session: AsyncSession, action_id: uuid.UUID, approver: str, decision: str, reason: str | None
) -> tuple[Action, Event] | tuple[None, None]:
    """Sprint 1 / audit C3: the status transition is the single atomic
    UPDATE below (WHERE status = 'pending'), not a separate read-then-
    write -- Postgres row-locks the matching row for the duration of a
    concurrent UPDATE, so of two racing decisions on the same action,
    only one can ever match and return a row. Returns None if the action
    doesn't exist or was no longer pending (already decided by someone
    else, possibly a moment ago) -- callers turn that into a 404/409, not
    a silent partial success.
    """
    from app.db.models import Approval

    result = await session.execute(
        update(Action)
        .where(Action.id == action_id, Action.status == "pending")
        .values(status=decision)
        .returning(Action)
    )
    action = result.scalar_one_or_none()
    if action is None:
        return None, None

    session.add(Approval(action_id=action.id, approver=approver, decision=decision, reason=reason))
    event = await record_event(
        session,
        action.id,
        "approval_decided",
        {"approver": approver, "decision": decision, "reason": reason},
    )
    await session.commit()
    await session.refresh(action)
    return action, event
