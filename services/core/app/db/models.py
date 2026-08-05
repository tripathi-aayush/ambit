import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

EMBEDDING_DIM = 1024  # voyage-3


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Plan(Base):
    """Web UI adapter (Phase 5): a task description decomposed by the LLM
    into a DAG of Action Objects (see planner.py). Each step is a real Action
    row (plan_id set), so it goes through the same risk/policy/approval
    pipeline every other adapter's actions do — Plan only adds ordering
    (Action.depends_on) and the execution/PR bookkeeping specific to this
    adapter's "execute in sandbox -> PR" flow."""

    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repositories.id"), nullable=False)

    task_description: Mapped[str] = mapped_column(String, nullable=False)
    branch_name: Mapped[str] = mapped_column(String, nullable=False)

    # planning -> pending_approval | executing -> completed | failed
    status: Mapped[str] = mapped_column(String, nullable=False, default="planning")
    pr_url: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    actions: Mapped[list["Action"]] = relationship(back_populates="plan", cascade="all, delete-orphan")


class Action(Base):
    __tablename__ = "actions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)

    action_type: Mapped[str] = mapped_column(String, nullable=False)
    target: Mapped[str] = mapped_column(String, nullable=False)

    actor_adapter: Mapped[str] = mapped_column(String, nullable=False)
    actor_agent_name: Mapped[str] = mapped_column(String, nullable=False)
    actor_user: Mapped[str | None] = mapped_column(String, nullable=True)

    environment: Mapped[str] = mapped_column(String, nullable=False, default="dev")
    branch: Mapped[str | None] = mapped_column(String, nullable=True)
    action_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    risk_score: Mapped[int | None] = mapped_column(nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String, nullable=True)

    # Web UI adapter (Phase 5): steps in a generated plan. NULL for actions
    # submitted directly via POST /actions by other adapters, which have no
    # DAG concept — pipeline.py stays adapter-agnostic.
    plan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    depends_on: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # sibling Action ids

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    events: Mapped[list["Event"]] = relationship(back_populates="action", cascade="all, delete-orphan")
    approvals: Mapped[list["Approval"]] = relationship(back_populates="action", cascade="all, delete-orphan")
    plan: Mapped["Plan"] = relationship(back_populates="actions")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    action_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actions.id"), nullable=False)

    approver: Mapped[str] = mapped_column(String, nullable=False)
    decision: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    action: Mapped["Action"] = relationship(back_populates="approvals")


class Event(Base):
    """Append-only audit trail: every Action Object, decision, and outcome."""

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    action_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actions.id"), nullable=False)

    event_type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    action: Mapped["Action"] = relationship(back_populates="events")


class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)

    clone_url: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    default_branch: Mapped[str | None] = mapped_column(String, nullable=True)
    local_path: Mapped[str] = mapped_column(String, nullable=False)

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    frameworks: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    files: Mapped[list["File"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    repo_chunks: Mapped[list["RepoChunk"]] = relationship(cascade="all, delete-orphan")
    doc: Mapped["RepositoryDoc"] = relationship(cascade="all, delete-orphan", uselist=False)


class File(Base):
    __tablename__ = "files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repositories.id"), nullable=False)

    path: Mapped[str] = mapped_column(String, nullable=False)
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    repository: Mapped["Repository"] = relationship(back_populates="files")
    symbols: Mapped[list["Symbol"]] = relationship(back_populates="file", cascade="all, delete-orphan")
    chunks: Mapped[list["Chunk"]] = relationship(back_populates="file", cascade="all, delete-orphan")
    summary: Mapped["FileSummary"] = relationship(
        back_populates="file", cascade="all, delete-orphan", uselist=False
    )
    ownership: Mapped[list["FileOwnership"]] = relationship(
        back_populates="file", cascade="all, delete-orphan"
    )


class Symbol(Base):
    __tablename__ = "symbols"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), nullable=False)

    symbol_type: Mapped[str] = mapped_column(String, nullable=False)  # function | class | import | route
    name: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[str | None] = mapped_column(String, nullable=True)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)

    file: Mapped["File"] = relationship(back_populates="symbols")


class DependencyEdge(Base):
    __tablename__ = "dependency_edges"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repositories.id"), nullable=False)

    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), nullable=False)
    target_file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id"), nullable=True)
    target_external_name: Mapped[str | None] = mapped_column(String, nullable=True)
    edge_type: Mapped[str] = mapped_column(String, nullable=False, default="import")


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), nullable=False)

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    start_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)

    file: Mapped["File"] = relationship(back_populates="chunks")


class FileSummary(Base):
    __tablename__ = "file_summaries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), nullable=False, unique=True)

    summary_text: Mapped[str] = mapped_column(String, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False, default="inferred")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    file: Mapped["File"] = relationship(back_populates="summary")


class FileOwnership(Base):
    __tablename__ = "file_ownership"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), nullable=False)

    author_name: Mapped[str] = mapped_column(String, nullable=False)
    author_email: Mapped[str] = mapped_column(String, nullable=False)
    commit_count: Mapped[int] = mapped_column(Integer, nullable=False)
    last_commit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    file: Mapped["File"] = relationship(back_populates="ownership")


class RepoChunk(Base):
    """Repository-scoped embeddable content that isn't tied to a single
    file: commit messages, PR/issue text. Separate from `chunks` (which is
    file-scoped) rather than a nullable file_id, so the file relationship
    on Chunk/File stays a real FK with real cascade semantics."""

    __tablename__ = "repo_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repositories.id"), nullable=False)

    source_type: Mapped[str] = mapped_column(String, nullable=False)  # commit | pr | issue
    source_id: Mapped[str] = mapped_column(String, nullable=False)  # sha | PR number | issue number
    title: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RepositoryDoc(Base):
    """Phase 4: LLM-generated architecture README + one sequence diagram.
    Generated on-demand (first view of the architecture page), not during
    ingestion — repos nobody looks at shouldn't pay the extra LLM cost.
    Same "inferred" tagging convention as FileSummary."""

    __tablename__ = "repository_docs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repositories.id"), nullable=False, unique=True)

    readme_markdown: Mapped[str] = mapped_column(String, nullable=False)
    sequence_diagram_title: Mapped[str] = mapped_column(String, nullable=False)
    sequence_diagram_mermaid: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False, default="inferred")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
