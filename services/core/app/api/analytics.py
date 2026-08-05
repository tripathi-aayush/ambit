"""Phase 8: read-only aggregation over existing Action/Approval/Plan data
for the developer analytics dashboard. No new write behavior -- purely
reporting on what the rest of the system already recorded."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Action, Approval, Plan
from app.db.session import get_session
from app.schemas import AnalyticsSummary

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
async def get_summary(session: AsyncSession = Depends(get_session)) -> AnalyticsSummary:
    total_actions = (await session.execute(select(func.count()).select_from(Action))).scalar_one()

    status_rows = (await session.execute(select(Action.status, func.count()).group_by(Action.status))).all()
    by_status = {status: count for status, count in status_rows}

    risk_rows = (
        await session.execute(
            select(Action.risk_level, func.count())
            .where(Action.risk_level.is_not(None))
            .group_by(Action.risk_level)
        )
    ).all()
    by_risk_level = {level: count for level, count in risk_rows}

    approval_rows = (
        await session.execute(select(Approval.decision, func.count()).group_by(Approval.decision))
    ).all()
    approvals_by_decision = {decision: count for decision, count in approval_rows}

    total_plans = (await session.execute(select(func.count()).select_from(Plan))).scalar_one()
    rollback_plans = (
        await session.execute(select(func.count()).select_from(Plan).where(Plan.reverts_action_id.is_not(None)))
    ).scalar_one()

    return AnalyticsSummary(
        total_actions=total_actions,
        by_status=by_status,
        by_risk_level=by_risk_level,
        approvals_approved=approvals_by_decision.get("approved", 0),
        approvals_denied=approvals_by_decision.get("denied", 0),
        total_plans=total_plans,
        rollback_plans=rollback_plans,
    )
