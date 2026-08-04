import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel


class ActionResponse(BaseModel):
    id: uuid.UUID
    action_type: str
    target: str
    actor_adapter: str
    actor_agent_name: str
    actor_user: Optional[str]
    environment: str
    branch: Optional[str]
    action_metadata: dict[str, Any]
    status: str
    risk_score: Optional[int]
    risk_level: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class EventResponse(BaseModel):
    id: uuid.UUID
    event_type: str
    payload: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalDecisionRequest(BaseModel):
    approver: str
    decision: Literal["approved", "denied"]
    reason: Optional[str] = None
