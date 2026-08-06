import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Action, Plan
from app.db.session import get_session
from app.events import event_bus, event_message
from app.executor import run_ready_actions
from app.pipeline import decide_approval
from app.schemas import ActionResponse, ApprovalDecisionRequest

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.post("/{action_id}", response_model=ActionResponse)
async def decide(
    action_id: uuid.UUID,
    decision_in: ApprovalDecisionRequest,
    session: AsyncSession = Depends(get_session),
):
    # Existence-only check, purely for a clean 404 vs 409 distinction --
    # this does NOT gate the actual decision. The real (and only) check for
    # "is this still pending" happens atomically inside decide_approval's
    # UPDATE ... WHERE status = 'pending', so two concurrent calls here
    # can't both succeed (sprint 1 / audit C3): whichever commits first
    # wins the row; the other gets None back and 409s below, instead of
    # both silently creating contradictory Approval rows.
    exists = await session.get(Action, action_id)
    if exists is None:
        raise HTTPException(status_code=404, detail="action not found")

    action, event = await decide_approval(
        session, action_id, decision_in.approver, decision_in.decision, decision_in.reason
    )
    if action is None:
        raise HTTPException(status_code=409, detail="action is no longer pending (already decided)")

    if action.plan_id is not None:
        # Web UI adapter plan step: a fresh approval may unblock dependents.
        event_bus.publish(action.plan_id, event_message(action, event))
        plan = await session.get(Plan, action.plan_id)
        try:
            await run_ready_actions(session, plan)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"execution failed: {exc}") from exc

    return action
