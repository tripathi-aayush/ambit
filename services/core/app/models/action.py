"""Mirrors packages/shared/action-object.schema.json, which is the source of
truth for the Action Object contract. Keep the two in lockstep by hand."""

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    file_write = "file_write"
    file_delete = "file_delete"
    git_commit = "git_commit"
    git_push = "git_push"
    shell_exec = "shell_exec"
    db_migration = "db_migration"


class Adapter(str, Enum):
    web_ui = "web_ui"
    claude_code = "claude_code"
    cli_wrapper = "cli_wrapper"


class Environment(str, Enum):
    dev = "dev"
    staging = "staging"
    prod = "prod"


class ActionActor(BaseModel):
    adapter: Adapter
    agent_name: str
    user: Optional[str] = None


class ActionObject(BaseModel):
    action_type: ActionType
    target: str
    actor: ActionActor
    environment: Environment = Environment.dev
    branch: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
