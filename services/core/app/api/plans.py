import asyncio
import json
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.models import Action, Event, Plan, Repository
from app.db.session import async_session, get_session
from app.events import event_bus, event_message
from app.executor import get_plan_lock, run_ready_actions
from app.models.action import Adapter, Environment
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

    if body.id is not None and await session.get(Plan, body.id) is not None:
        raise HTTPException(status_code=409, detail="a plan with this id already exists")

    try:
        plan = await generate_plan(
            session,
            repo,
            body.task_description,
            Environment(body.environment),
            adapter=Adapter(body.adapter),
            plan_id=body.id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"plan generation failed: {exc}") from exc

    # Orion CLI (adapter #2): dry_run generates the DAG (each step already
    # risk/policy-scored) without running any of it -- `orion plan` shows
    # what would happen; `POST /plans/{id}/run` below executes it later.
    # Default (False) preserves the web UI's existing always-execute
    # behavior exactly.
    if not body.dry_run:
        await run_ready_actions(session, plan)
    return await _get_plan_or_404(plan.id, session)


@router.post("/plans/{plan_id}/run", response_model=PlanResponse)
async def run_plan(plan_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Explicitly executes every currently-ready action in an already-
    generated plan -- the second half of a dry_run `orion plan` /
    `orion run` pair, and also how `orion implement` resumes a plan whose
    approval was decided elsewhere. Mirrors create_plan's own post-generate
    call to run_ready_actions exactly."""
    plan = await _get_plan_or_404(plan_id, session)
    try:
        await run_ready_actions(session, plan)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"execution failed: {exc}") from exc
    return await _get_plan_or_404(plan.id, session)


PLAN_WAIT_TIMEOUT = 5.0  # covers the client-generates-id-then-races-the-POST window
HEARTBEAT_INTERVAL = 15.0  # keeps the connection alive through a long approval wait


def _sse(event_name: str, data: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(data)}\n\n"


async def _wait_for_plan(plan_id: uuid.UUID, session: AsyncSession) -> Plan | None:
    deadline = time.monotonic() + PLAN_WAIT_TIMEOUT
    while True:
        result = await session.execute(
            select(Plan).where(Plan.id == plan_id).options(selectinload(Plan.actions))
        )
        plan = result.scalar_one_or_none()
        if plan is not None:
            return plan
        if time.monotonic() >= deadline:
            return None
        await asyncio.sleep(0.2)


@router.get("/plans/{plan_id}/stream")
async def stream_plan(plan_id: uuid.UUID):
    """Orion Phase 2 (live runtime): replays a plan's history, then
    live-tails new events until every action reaches a terminal state.

    Opens its own DB session (not the request-scoped one from
    Depends(get_session)) because this connection outlives a normal
    request/response cycle -- same established pattern as
    app/ingestion/pipeline.py's run_ingestion, just for a streaming
    response instead of a background task.

    Ordering is deliberate and load-bearing: subscribe to the event bus
    BEFORE replaying history from the DB. Replaying first would leave a
    real race window -- an event published between "finished reading
    history" and "started listening" would be silently lost. Subscribing
    first means anything published during replay just queues up and gets
    drained (with duplicates dropped by event id) right after.
    """

    async def generate():
        async with async_session() as session:
            plan = await _wait_for_plan(plan_id, session)
            if plan is None:
                yield _sse("error", {"detail": "plan not found"})
                return

            yield "retry: 2000\n\n"

            async with event_bus.subscribe(plan_id) as queue:
                yield _sse("plan_snapshot", PlanResponse.model_validate(plan).model_dump(mode="json"))

                seen_event_ids: set[str] = set()
                known_actions: dict[str, str] = {}  # action id -> status, grows as actions appear

                for action in plan.actions:
                    known_actions[str(action.id)] = action.status
                    events_result = await session.execute(
                        select(Event).where(Event.action_id == action.id).order_by(Event.created_at)
                    )
                    for event in events_result.scalars().all():
                        seen_event_ids.add(str(event.id))
                        yield _sse("action_event", event_message(action, event))

                def is_resolved() -> bool:
                    # Empty on purpose while still planning (no actions
                    # exist yet) -- must not read as "resolved" just
                    # because there's nothing to check yet.
                    if not known_actions:
                        return False
                    statuses = known_actions.values()
                    # run_ready_actions (executor.py) halts the ENTIRE
                    # plan the moment any single action fails or is
                    # denied -- siblings that were never reached stay at
                    # "approved" forever, not some terminal status, so
                    # waiting for *every* action to be terminal would hang
                    # this stream indefinitely on any failure. One
                    # failed/denied action is exactly as final as all of
                    # them completing -- found via direct testing (a
                    # failing shell_exec step's downstream sibling
                    # deadlocked this exact loop before this check existed).
                    if any(status in ("failed", "denied") for status in statuses):
                        return True
                    return all(status == "completed" for status in statuses)

                while not is_resolved():
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL)
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
                        continue

                    event_id = message.get("event", {}).get("id")
                    if event_id in seen_event_ids:
                        continue  # already delivered during replay
                    if event_id:
                        seen_event_ids.add(event_id)

                    action_data = message.get("action") or {}
                    if action_data.get("id"):
                        known_actions[action_data["id"]] = action_data.get("status", "pending")

                    yield _sse(message.get("type", "action_event"), message)

                yield _sse("stream_end", {"plan_id": str(plan_id)})

    return StreamingResponse(generate(), media_type="text/event-stream")


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
