import asyncio
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.models import Action, Plan, Repository
from app.db.session import get_session
from app.executor import get_plan_lock, run_ready_actions
from app.models.action import Environment
from app.planner import generate_plan
from app.schemas import PlanCreateRequest, PlanResponse

router = APIRouter(tags=["plans"])


async def _get_plan_or_404(plan_id: uuid.UUID, session: AsyncSession) -> Plan:
    # session.get() would return an already identity-mapped Plan (loaded
    # earlier in this request without `actions` eagerly loaded) without
    # applying these options — a real SELECT is needed to force the reload.
    result = await session.execute(
        select(Plan).where(Plan.id == plan_id).options(selectinload(Plan.actions))
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="plan not found")
    return plan


@router.post("/repos/{repo_id}/plans", response_model=PlanResponse)
async def create_plan(
    repo_id: uuid.UUID, body: PlanCreateRequest, session: AsyncSession = Depends(get_session)
):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="repository not found")

    try:
        plan = await generate_plan(session, repo, body.task_description, Environment(body.environment))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"plan generation failed: {exc}") from exc

    await run_ready_actions(session, plan)
    return await _get_plan_or_404(plan.id, session)


@router.get("/repos/{repo_id}/plans", response_model=list[PlanResponse])
async def list_plans(repo_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Plan)
        .where(Plan.repository_id == repo_id)
        .options(selectinload(Plan.actions))
        .order_by(Plan.created_at.desc())
    )
    return result.scalars().unique().all()


@router.get("/plans/{plan_id}", response_model=PlanResponse)
async def get_plan(plan_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    return await _get_plan_or_404(plan_id, session)


@router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(plan_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Sprint 2 / audit H3: deletes one plan (and its actions/events/
    approvals via cascade) without touching its repository, then removes
    its working directory."""
    plan = await session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="plan not found")

    async with get_plan_lock(plan_id):
        # A revert plan elsewhere may point at one of this plan's actions
        # via reverts_action_id -- clear those first, same reasoning as
        # DELETE /repos/{id} (see that handler's comment).
        await session.execute(
            update(Plan)
            .where(Plan.reverts_action_id.in_(select(Action.id).where(Action.plan_id == plan_id)))
            .values(reverts_action_id=None)
        )
        await session.delete(plan)
        await session.commit()

    await asyncio.to_thread(shutil.rmtree, Path(settings.plans_dir) / str(plan_id), ignore_errors=True)
    return Response(status_code=204)
