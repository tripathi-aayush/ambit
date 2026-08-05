"""Phase 5 (Web UI adapter): turns a natural-language task into a DAG of
Action Objects, each submitted through the same submit_action() pipeline
every adapter uses (risk scoring + OPA policy + approval gating apply
per-step, unchanged). This module only adds ordering (Action.depends_on)
and plan bookkeeping — it does not execute anything (see executor.py).

Grounding: reuses rag.py's retrieval to find task-relevant chunks, then
reads the FULL current content of the top candidate files directly from
the already-cloned repository on disk (chunks are partial; an LLM editing
a file needs to see the whole thing to reproduce it accurately). For
file_write steps, the model outputs the complete new file content, not a
diff — for large files this risks the model subtly dropping or altering
unrelated parts it was supposed to leave untouched. Acceptable for a first
real-execution pass; diff-based editing would be a follow-up refinement.
"""

import re
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Action, File, FileSummary, Plan, Repository
from app.llm import get_llm_client
from app.models.action import ActionActor, ActionObject, ActionType, Adapter, Environment
from app.pipeline import submit_action
from app.rag import retrieve

MAX_CANDIDATE_FILES = 5
MAX_FILE_CONTENT_CHARS = 6000
MAX_SUMMARIES_IN_PROMPT = 30

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Short local id, e.g. 'step-1'. Unique within this plan."},
                    "description": {"type": "string", "description": "One sentence: what this step does and why."},
                    "action_type": {
                        "type": "string",
                        "enum": ["file_write", "file_delete", "shell_exec", "git_commit", "git_push"],
                    },
                    "target": {
                        "type": "string",
                        "description": (
                            "file_write/file_delete: repo-relative file path. shell_exec: the shell command. "
                            "git_commit/git_push: leave as an empty string, it's filled in automatically."
                        ),
                    },
                    "content": {
                        "type": ["string", "null"],
                        "description": "file_write only: the COMPLETE new content of the file. Null otherwise.",
                    },
                    "commit_message": {
                        "type": ["string", "null"],
                        "description": "git_commit only: the commit message. Null otherwise.",
                    },
                    "depends_on": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "ids of steps in this same list that must complete first.",
                    },
                },
                "required": ["id", "description", "action_type", "target", "content", "commit_message", "depends_on"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["steps"],
    "additionalProperties": False,
}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:40] or "task"


async def _gather_planning_context(session: AsyncSession, repo: Repository, task_description: str) -> str:
    hits = await retrieve(session, repo.id, task_description, top_k=MAX_CANDIDATE_FILES * 2)

    candidate_paths: list[str] = []
    for hit in hits:
        if hit.kind != "code":
            continue
        path = hit.label.split(":")[0]
        if path not in candidate_paths:
            candidate_paths.append(path)
        if len(candidate_paths) >= MAX_CANDIDATE_FILES:
            break

    repo_root = Path(repo.local_path)
    file_blocks = []
    for path in candidate_paths:
        full_path = repo_root / path
        try:
            content = full_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        file_blocks.append(f"--- {path} (current full content) ---\n{content[:MAX_FILE_CONTENT_CHARS]}")

    summaries_result = await session.execute(
        select(File.path, FileSummary.summary_text)
        .join(FileSummary, FileSummary.file_id == File.id)
        .where(File.repository_id == repo.id)
        .order_by(File.path)
        .limit(MAX_SUMMARIES_IN_PROMPT)
    )

    lines = [
        f"Repository: {repo.name}",
        f"Detected frameworks: {', '.join(repo.frameworks) or 'none detected'}",
        "",
        "Per-file summaries (auto-generated, may be incomplete):",
    ]
    for path, summary in summaries_result.all():
        lines.append(f"- {path}: {summary}")

    lines.append("\nCandidate files likely relevant to this task, with their full current content:")
    lines.extend(file_blocks or ["(no closely-matching file found by search — you may need to create a new file)"])

    return "\n".join(lines)


def _build_prompt(task_description: str, context: str) -> str:
    return (
        "You are planning a code change for the task below. Produce a DAG of steps that "
        "implements it, to be executed automatically then opened as a pull request.\n\n"
        "Rules:\n"
        "- Prefer editing 1-3 existing files over creating many new ones.\n"
        "- For file_write steps, output the file's COMPLETE new content (not a diff/patch) — "
        "start from the current content shown below and make the minimal change needed.\n"
        "- Only use shell_exec if the task genuinely requires running a command (e.g. installing "
        "a dependency) — most tasks need only file_write/file_delete steps.\n"
        "- The plan MUST end with exactly one git_commit step that depends on every "
        "file_write/file_delete step, followed by exactly one git_push step that depends on "
        "the git_commit step. Leave target empty ('') for both — it's filled in automatically.\n"
        "- Do not invent file paths that don't relate to the task or the codebase shown below.\n\n"
        f"Task: {task_description}\n\n"
        f"Repository context:\n{context}"
    )


async def generate_plan(
    session: AsyncSession, repo: Repository, task_description: str, environment: Environment = Environment.dev
) -> Plan:
    context = await _gather_planning_context(session, repo, task_description)
    prompt = _build_prompt(task_description, context)

    client = get_llm_client()
    data = await client.structured_completion(prompt, PLAN_SCHEMA, max_tokens=4000)
    steps = data["steps"]

    plan = Plan(
        repository_id=repo.id,
        task_description=task_description,
        branch_name=f"ambit/{_slugify(task_description)}-{uuid.uuid4().hex[:8]}",
        status="planning",
    )
    session.add(plan)
    await session.flush()

    local_to_action_id: dict[str, uuid.UUID] = {}
    created: list[tuple[Action, list[str]]] = []

    for step in steps:
        action_type = ActionType(step["action_type"])
        if action_type in (ActionType.git_commit, ActionType.git_push):
            target = plan.branch_name
        else:
            target = step["target"]

        metadata: dict = {"description": step["description"]}
        if action_type == ActionType.file_write:
            metadata["content"] = step["content"] or ""
        if action_type == ActionType.git_commit:
            metadata["commit_message"] = step["commit_message"] or f"Ambit: {task_description}"

        action_obj = ActionObject(
            action_type=action_type,
            target=target,
            actor=ActionActor(adapter=Adapter.web_ui, agent_name="ambit-planner"),
            environment=environment,
            branch=plan.branch_name,
            metadata=metadata,
        )
        action = await submit_action(session, action_obj)
        local_to_action_id[step["id"]] = action.id
        created.append((action, step["depends_on"]))

    for action, local_deps in created:
        action.plan_id = plan.id
        action.depends_on = [str(local_to_action_id[d]) for d in local_deps if d in local_to_action_id]

    plan.status = "pending_approval"
    await session.commit()
    await session.refresh(plan)
    return plan
