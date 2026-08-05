import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Action, Plan
from app.db.session import get_session
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
    action = await session.get(Action, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    if action.status != "pending":
        raise HTTPException(status_code=409, detail=f"action is already '{action.status}', not pending")

    action = await decide_approval(
        session, action, decision_in.approver, decision_in.decision, decision_in.reason
    )

    if action.plan_id is not None:
        # Web UI adapter plan step: a fresh approval may unblock dependents.
        plan = await session.get(Plan, action.plan_id)
        try:
            await run_ready_actions(session, plan)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"execution failed: {exc}") from exc

    return action
