"""Phase 6: reverts a single completed file_write/file_delete action by
constructing a new mini-plan (inverse file step -> commit -> push -> PR),
executed through the exact same pipeline as any other plan.

Reverting is itself risk-scored and policy-gated like any other action —
restoring a deleted prod file is exactly the kind of thing that should
still go through review, not bypass it just because it's technically an
"undo". It also always goes through a fresh PR rather than force-reverting
on the original branch, for the same reason: no new trust boundary beyond
what the forward execution path already enforces.

git_commit/git_push actions aren't independently revertable — they're
just mechanical steps with no content of their own; reverting "a commit"
in practice means reverting the file changes that made it up, which is
exactly what this does.
"""

import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Action, Plan, Repository
from app.models.action import ActionActor, ActionObject, ActionType, Adapter, Environment
from app.pipeline import submit_action

ROLLBACKABLE_ACTION_TYPES = {"file_write", "file_delete"}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:40] or "revert"


async def create_rollback_plan(session: AsyncSession, action: Action) -> Plan:
    if action.action_type not in ROLLBACKABLE_ACTION_TYPES:
        raise ValueError(f"action_type '{action.action_type}' cannot be rolled back directly")
    if action.status != "completed":
        raise ValueError("only a completed action can be rolled back")
    if action.plan_id is None:
        raise ValueError("cannot roll back an action with no associated plan (no repository to target)")

    original_plan = await session.get(Plan, action.plan_id)
    repo = await session.get(Repository, original_plan.repository_id)
    previous_content = action.action_metadata.get("previous_content")

    if action.action_type == "file_delete" and previous_content is None:
        raise ValueError("cannot revert this delete: original content was not captured")

    if previous_content is None:
        # Reverting a file_write that created a new file: undo = delete it.
        inverse_type = ActionType.file_delete
        inverse_metadata = {"description": f"Revert: remove {action.target} (it did not exist before)"}
    else:
        inverse_type = ActionType.file_write
        inverse_metadata = {
            "content": previous_content,
            "description": f"Revert: restore prior content of {action.target}",
        }

    original_description = action.action_metadata.get("description", action.target)
    task_description = f"Revert: {original_description}"

    plan = Plan(
        repository_id=repo.id,
        task_description=task_description,
        branch_name=f"orion/revert-{_slugify(action.target)}-{uuid.uuid4().hex[:8]}",
        status="planning",
        reverts_action_id=action.id,
    )
    session.add(plan)
    await session.flush()

    environment = Environment(action.environment)

    async def _submit(action_type: ActionType, target: str, metadata: dict) -> Action:
        obj = ActionObject(
            action_type=action_type,
            target=target,
            actor=ActionActor(adapter=Adapter.web_ui, agent_name="orion-rollback"),
            environment=environment,
            branch=plan.branch_name,
            metadata=metadata,
        )
        return await submit_action(session, obj)

    inverse_action = await _submit(inverse_type, action.target, inverse_metadata)
    commit_action = await _submit(
        ActionType.git_commit,
        plan.branch_name,
        {"description": "Commit the revert", "commit_message": f"Revert: {original_description}"},
    )
    push_action = await _submit(
        ActionType.git_push, plan.branch_name, {"description": "Push the revert branch and open a PR"}
    )

    inverse_action.plan_id = plan.id
    inverse_action.depends_on = []
    commit_action.plan_id = plan.id
    commit_action.depends_on = [str(inverse_action.id)]
    push_action.plan_id = plan.id
    push_action.depends_on = [str(commit_action.id)]

    plan.status = "pending_approval"
    await session.commit()
    await session.refresh(plan)
    return plan
