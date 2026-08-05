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
    plan_id: Optional[uuid.UUID]
    depends_on: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class PlanCreateRequest(BaseModel):
    task_description: str
    environment: Literal["dev", "staging", "prod"] = "dev"


class PlanResponse(BaseModel):
    id: uuid.UUID
    repository_id: uuid.UUID
    task_description: str
    branch_name: str
    status: str
    pr_url: Optional[str]
    error: Optional[str]
    created_at: datetime
    actions: list[ActionResponse] = []

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


class RepoIngestRequest(BaseModel):
    clone_url: str


class RepositoryResponse(BaseModel):
    id: uuid.UUID
    clone_url: str
    name: str
    status: str
    error: Optional[str]
    frameworks: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class SymbolResponse(BaseModel):
    id: uuid.UUID
    symbol_type: str
    name: str
    detail: Optional[str]
    start_line: int
    end_line: int

    model_config = {"from_attributes": True}


class FileSummaryResponse(BaseModel):
    summary_text: str
    confidence: float
    model: str
    source: str

    model_config = {"from_attributes": True}


class FileOwnershipResponse(BaseModel):
    author_name: str
    author_email: str
    commit_count: int
    last_commit_at: Optional[datetime]

    model_config = {"from_attributes": True}


class FileResponse(BaseModel):
    id: uuid.UUID
    path: str
    language: Optional[str]
    size_bytes: int
    symbols: list[SymbolResponse] = []
    summary: Optional[FileSummaryResponse] = None
    ownership: list[FileOwnershipResponse] = []

    model_config = {"from_attributes": True}


class DependencyEdgeResponse(BaseModel):
    source_file_id: uuid.UUID
    target_file_id: Optional[uuid.UUID]
    target_external_name: Optional[str]
    edge_type: str

    model_config = {"from_attributes": True}


class SearchResultResponse(BaseModel):
    file_path: str
    chunk_content: str
    start_line: Optional[int]
    end_line: Optional[int]
    distance: float


class ChatMessageRequest(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessageRequest]


class ChatSourceResponse(BaseModel):
    kind: str
    label: str
    content: str
    url: Optional[str]
    distance: float


class ChatResponse(BaseModel):
    answer: str
    sources: list[ChatSourceResponse]
    not_enough_information: bool


class RepositoryDocResponse(BaseModel):
    readme_markdown: str
    sequence_diagram_title: str
    sequence_diagram_mermaid: str
    model: str
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}
