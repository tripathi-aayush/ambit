import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Action, Event
from app.db.session import get_session
from app.models.action import ActionObject
from app.pipeline import submit_action
from app.schemas import ActionResponse, EventResponse

router = APIRouter(prefix="/actions", tags=["actions"])


@router.post("", response_model=ActionResponse)
async def create_action(action_in: ActionObject, session: AsyncSession = Depends(get_session)):
    action = await submit_action(session, action_in)
    return action


@router.get("", response_model=list[ActionResponse])
async def list_actions(status: str | None = None, session: AsyncSession = Depends(get_session)):
    query = select(Action).order_by(Action.created_at.desc())
    if status:
        query = query.where(Action.status == status)
    result = await session.execute(query)
    return result.scalars().all()


@router.get("/{action_id}", response_model=ActionResponse)
async def get_action(action_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    action = await session.get(Action, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    return action


@router.get("/{action_id}/events", response_model=list[EventResponse])
async def get_action_events(action_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    action = await session.get(Action, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    result = await session.execute(
        select(Event).where(Event.action_id == action_id).order_by(Event.created_at)
    )
    return result.scalars().all()
