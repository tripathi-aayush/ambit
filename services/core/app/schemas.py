import re
import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, field_validator

# Sprint 1 / audit C5: only plain HTTPS github.com URLs. An allowlist
# (rather than blocking specific bad patterns like a leading '-', file://,
# ext::) covers unknown-future-bypass variants too, since anything not
# matching this exact shape is rejected regardless of what it says.
GITHUB_HTTPS_URL_RE = re.compile(r"^https://github\.com/[\w.-]+/[\w.-]+(?:\.git)?/?$")


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
    reverts_action_id: Optional[uuid.UUID]
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

    @field_validator("clone_url")
    @classmethod
    def _validate_clone_url(cls, value: str) -> str:
        # Rejects a leading '-' (git argument injection), file://, ext::,
        # and any other scheme -- validated here, before any Repository
        # row or clone operation is created, not defensively later.
        if not GITHUB_HTTPS_URL_RE.match(value):
            raise ValueError("clone_url must be a plain https://github.com/<owner>/<repo> URL")
        return value


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


class AnalyticsSummary(BaseModel):
    total_actions: int
    by_status: dict[str, int]
    by_risk_level: dict[str, int]
    approvals_approved: int
    approvals_denied: int
    total_plans: int
    rollback_plans: int
