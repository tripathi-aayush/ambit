"""Phase 5 (Web UI adapter): executes an approved plan's steps.

Only file_write/file_delete/git_commit/git_push run here directly, against
a dedicated per-plan clone — these are structured, already mediated by the
Action Object + risk/policy check in planner.py, not arbitrary commands.
git_push additionally needs real network egress to reach GitHub.

shell_exec is the one action type that runs genuinely untrusted content (an
LLM-authored command), so it's routed through the Phase 0 sandbox
(infra/sandbox: an isolated, --network none, resource-limited container)
via `docker exec` into the already-running sandbox container, rather than
running on the host.
"""

import asyncio
import json
import subprocess
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import Action, Plan, Repository
from app.events import event_bus, event_message
from app.github_client import clone_repo, create_pull_request, get_default_branch, push_branch
from app.pipeline import record_event
from app.pr_description import build_pr_body

SANDBOX_EXEC_OVERHEAD = 15  # slack added on top of runner.py's own --timeout, for the docker-exec hop itself

# Sprint 2 / audit H2: one lock per plan, serializing anything that
# touches its execution. run_ready_actions() acquires this for its whole
# body, so two concurrent triggers for the same plan (e.g. two approvals
# landing close together, or a retried request) can't both act on the
# same ready action -- the second simply waits its turn and then re-reads
# fresh state, rather than racing the first. Deletion (api/repos.py,
# api/plans.py -- sprint 2 H3) acquires the same lock before removing
# anything, so a plan can never be mid-execution and mid-delete at once.
#
# asyncio.Lock only coordinates within one process/event loop -- correct
# for this single-process deployment (confirmed: no --workers, no
# multi-process setup anywhere in this project), but would NOT be
# sufficient if that ever changes to multiple processes/workers, which
# would need a DB-level lock instead. Entries are never removed: one
# Lock object per plan for the life of the process is a few dozen bytes,
# bounded by total plans ever created in this process's lifetime --
# negligible, not worth reference-counted cleanup for this sprint.
_plan_locks: dict[uuid.UUID, asyncio.Lock] = {}


def get_plan_lock(plan_id: uuid.UUID) -> asyncio.Lock:
    lock = _plan_locks.get(plan_id)
    if lock is None:
        lock = asyncio.Lock()
        _plan_locks[plan_id] = lock
    return lock


class ExecutionError(Exception):
    pass


def _resolve_target(wd: Path, target: str) -> Path:
    """Joins `target` onto the plan's working directory and rejects
    anything that escapes it -- either `../` traversal or an absolute
    path, which `Path.__truediv__` would otherwise silently let override
    `wd` entirely. Sprint 1 / audit C2. Raises ExecutionError (caught the
    same way any other execution failure is) rather than letting a bad
    target write/delete outside the sandboxed clone."""
    resolved = (wd / target).resolve()
    wd_resolved = wd.resolve()
    if not resolved.is_relative_to(wd_resolved):
        raise ExecutionError(f"target path '{target}' escapes the plan working directory")
    return resolved


def _working_dir(plan: Plan) -> Path:
    return Path(settings.plans_dir) / str(plan.id)


def _ensure_working_dir(plan: Plan, repo: Repository) -> Path:
    wd = _working_dir(plan)
    if not wd.exists():
        clone_repo(repo.clone_url, wd)
        subprocess.run(["git", "checkout", "-b", plan.branch_name], cwd=str(wd), check=True, capture_output=True, text=True)
        subprocess.run(["git", "config", "user.email", "orion@localhost"], cwd=str(wd), check=True)
        subprocess.run(["git", "config", "user.name", "Orion"], cwd=str(wd), check=True)
    return wd


def _sandbox_timeout(workspace: str | None) -> int:
    # Mirrors runner.py's own --workspace/default timeout so the outer
    # `docker exec` (this process waiting on the inner one) is never
    # tighter than what the inner command was actually given to run in.
    return 300 if workspace else 60


async def _run_in_sandbox(
    session: AsyncSession,
    action: Action,
    plan: Plan,
    command: str,
    *,
    image: str | None = None,
    workspace: str | None = None,
    network: bool = False,
) -> dict:
    """workspace, if given, is the plan id -- resolved against /plans
    inside the sandbox container, which docker-compose.yml bind-mounts to
    the same host directory core writes plan clones into (see
    docker-compose.yml's sandbox.volumes and app.config.plans_dir).
    runner.py then docker-cp's that content into the actual test
    container, rather than mounting it — see runner.py's docstring for why.

    Orion Phase 2 (live runtime): runner.py streams one NDJSON line per
    output line from the target command to its own stdout as it runs
    (see runner.py), instead of one final JSON blob -- this reads that
    stream incrementally via asyncio.create_subprocess_exec (native async,
    no thread-crossing needed) and records+publishes a "shell_output"
    event per line, live, as it arrives. Native asyncio subprocess reads
    stdout/stderr concurrently via asyncio.gather so a chatty docker-exec
    stderr can't deadlock the stdout protocol reader (the classic
    two-pipes-one-thread pitfall) -- runner.py's real content all comes
    through stdout; this process's own stderr is only ever populated by a
    genuine docker-exec failure (container gone, etc.), not by the target
    command's output.
    """
    runner_args = ["docker", "exec", settings.sandbox_container_name, "python3", "runner.py"]
    if image:
        runner_args += ["--image", image]
    if workspace:
        runner_args += ["--workspace", f"/plans/{workspace}"]
    if network:
        runner_args += ["--network"]
    runner_args.append(command)

    exec_timeout = _sandbox_timeout(workspace) + SANDBOX_EXEC_OVERHEAD

    proc = await asyncio.create_subprocess_exec(
        *runner_args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    result: dict = {}

    async def _read_protocol() -> None:
        assert proc.stdout is not None
        async for raw_line in proc.stdout:
            try:
                msg = json.loads(raw_line)
            except json.JSONDecodeError:
                continue  # tolerate stray non-protocol output rather than crashing the whole action
            if msg.get("type") == "output":
                stream = msg.get("stream", "stdout")
                line = msg.get("line", "")
                (stdout_lines if stream == "stdout" else stderr_lines).append(line)
                event = await record_event(session, action.id, "shell_output", {"stream": stream, "line": line})
                await session.commit()
                event_bus.publish(plan.id, event_message(action, event))
            elif msg.get("type") == "result":
                result["exit_code"] = msg.get("exit_code")

    async def _drain_docker_stderr() -> str:
        assert proc.stderr is not None
        data = await proc.stderr.read()
        return data.decode(errors="replace")

    try:
        _, docker_stderr = await asyncio.wait_for(
            asyncio.gather(_read_protocol(), _drain_docker_stderr()), timeout=exec_timeout
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise ExecutionError(f"sandbox exec timed out after {exec_timeout}s")

    returncode = await proc.wait()
    if "exit_code" not in result:
        # runner.py never sent a final result line -- docker exec itself
        # failed (container missing, image pull failed, etc.), not the
        # target command.
        raise ExecutionError(f"sandbox exec itself failed: {docker_stderr or f'docker exec exited {returncode}'}")

    return {"exit_code": result["exit_code"], "stdout": "\n".join(stdout_lines), "stderr": "\n".join(stderr_lines)}


def _do_git_commit(wd: Path, message: str) -> dict:
    """Sprint 2 / audit H1: entirely synchronous (git subprocess calls) --
    call via asyncio.to_thread, never directly from async code. Behavior
    unchanged from before this was extracted out of _run_action, just
    moved off the event loop."""
    add = subprocess.run(["git", "add", "-A"], cwd=str(wd), capture_output=True, text=True)
    if add.returncode != 0:
        raise ExecutionError(f"git add failed: {add.stderr}")
    status = subprocess.run(["git", "status", "--porcelain"], cwd=str(wd), capture_output=True, text=True)
    if not status.stdout.strip():
        return {"note": "nothing to commit"}
    commit = subprocess.run(["git", "commit", "-m", message], cwd=str(wd), capture_output=True, text=True)
    if commit.returncode != 0:
        raise ExecutionError(f"git commit failed: {commit.stderr}")
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(wd), capture_output=True, text=True, check=True
    ).stdout.strip()
    return {"commit_output": commit.stdout, "commit_sha": sha}


def _do_git_push(wd: Path, plan_branch: str, base_branch: str, clone_url: str, token: str) -> dict | None:
    """Sprint 2 / audit H1: synchronous git subprocess calls (the diff
    precheck + the actual push) -- call via asyncio.to_thread. Returns a
    "nothing to push" output dict if there's nothing new (same early-exit
    as before extraction), else None, meaning the caller should proceed to
    (async) PR creation. Raises subprocess.CalledProcessError on a failed
    push, exactly as push_branch() already did -- caller's except clause
    is unchanged."""
    diff_count = subprocess.run(
        ["git", "rev-list", f"{base_branch}..HEAD", "--count"], cwd=str(wd), capture_output=True, text=True
    )
    if diff_count.returncode == 0 and diff_count.stdout.strip() == "0":
        return {"note": f"nothing to push — branch already matches '{base_branch}'"}
    push_branch(wd, plan_branch, clone_url, token)
    return None


async def _run_action(session: AsyncSession, action: Action, wd: Path, plan: Plan, repo: Repository) -> dict:
    """Returns an output payload to record on success; raises ExecutionError on failure."""
    if action.action_type == "file_write":
        target = _resolve_target(wd, action.target)
        previous_content = target.read_text(encoding="utf-8") if target.exists() else None
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(action.action_metadata["content"], encoding="utf-8")
        # Reassigned (not mutated in place) so SQLAlchemy detects the JSONB
        # change. Kept on the action itself, not just the event payload, so
        # Phase 6's diff view and rollback survive the plan's working
        # directory being cleaned up later.
        action.action_metadata = {**action.action_metadata, "previous_content": previous_content}
        return {"wrote_bytes": len(action.action_metadata["content"])}

    if action.action_type == "file_delete":
        target = _resolve_target(wd, action.target)
        previous_content = target.read_text(encoding="utf-8") if target.exists() else None
        if target.exists():
            target.unlink()
        action.action_metadata = {**action.action_metadata, "previous_content": previous_content}
        return {}

    if action.action_type == "shell_exec":
        is_test_run = action.action_metadata.get("purpose") == "test_run"
        result = await _run_in_sandbox(
            session,
            action,
            plan,
            action.target,
            image=action.action_metadata.get("image"),
            workspace=str(plan.id) if is_test_run else None,
            network=is_test_run,
        )
        if result.get("exit_code") != 0:
            # Test runners (pytest, etc.) write the actually-useful failure
            # detail — assertion diffs, collection errors — to stdout, not
            # stderr. Surfacing stderr alone made real test failures show
            # up as a near-empty, useless error message.
            stdout = (result.get("stdout") or "").strip()
            stderr = (result.get("stderr") or "").strip()
            detail = "\n".join(part for part in (stdout[-2000:], stderr[-500:]) if part)
            raise ExecutionError(f"command exited {result.get('exit_code')}: {detail}")
        return result

    if action.action_type == "git_commit":
        message = action.action_metadata.get("commit_message", "Orion automated change")
        result = await asyncio.to_thread(_do_git_commit, wd, message)
        if "commit_sha" in result:
            action.action_metadata = {**action.action_metadata, "commit_sha": result["commit_sha"]}
        return result

    if action.action_type == "git_push":
        if not settings.github_token:
            raise ExecutionError("GITHUB_TOKEN is not configured — cannot push or open a PR")

        base_branch = repo.default_branch or await get_default_branch(repo.clone_url, settings.github_token)
        repo.default_branch = base_branch

        # A revert (or any plan) whose net effect matches the base branch
        # already has nothing to open a PR for — GitHub's API would 422 on
        # this with a generic "No commits between X and Y", which is
        # confusing to surface as a plan failure. Check first, since it's
        # a legitimate outcome (e.g. reverting a change whose forward PR
        # was never merged), not an error.
        try:
            precheck = await asyncio.to_thread(
                _do_git_push, wd, plan.branch_name, base_branch, repo.clone_url, settings.github_token
            )
        except subprocess.CalledProcessError as exc:
            raise ExecutionError(f"git push failed: {exc.stderr}") from exc
        if precheck is not None:
            return precheck

        pr = await create_pull_request(
            settings.github_token,
            repo.clone_url,
            head_branch=plan.branch_name,
            base_branch=base_branch,
            title=f"Orion: {plan.task_description}"[:255],
            body=await build_pr_body(session, plan),
        )
        plan.pr_url = pr["html_url"]
        return {"pr_url": pr["html_url"]}

    raise ExecutionError(f"no executor for action_type '{action.action_type}'")


async def execute_action(session: AsyncSession, action: Action, plan: Plan, repo: Repository) -> None:
    action.status = "executing"
    event = await record_event(session, action.id, "execution_started", {})
    await session.commit()
    event_bus.publish(plan.id, event_message(action, event))

    wd = await asyncio.to_thread(_ensure_working_dir, plan, repo)

    try:
        output = await _run_action(session, action, wd, plan, repo)
    except Exception as exc:  # noqa: BLE001 - must not crash the plan loop; failure is a normal outcome
        action.status = "failed"
        event = await record_event(session, action.id, "execution_failed", {"error": str(exc)})
        await session.commit()
        event_bus.publish(plan.id, event_message(action, event))
        raise
    else:
        action.status = "completed"
        event = await record_event(session, action.id, "execution_completed", {"output": output})
        await session.commit()
        event_bus.publish(plan.id, event_message(action, event))


async def run_ready_actions(session: AsyncSession, plan: Plan) -> None:
    """Executes every currently-unblocked, approved step, then recurses to
    pick up newly-unblocked steps, until the plan is fully executed, blocked
    on a pending approval, or has failed.

    Sprint 2 / audit H2: the whole body runs under this plan's lock, so a
    second concurrent call for the same plan (e.g. two approvals arriving
    close together) blocks until the first finishes rather than both
    racing to execute the same ready action -- see get_plan_lock()."""
    async with get_plan_lock(plan.id):
        repo = await session.get(Repository, plan.repository_id)

        while True:
            # populate_existing=True: without this, a plain SELECT for a
            # row this session already has identity-mapped (e.g. from an
            # earlier iteration, or from this same request's decide_approval
            # call) returns the cached in-memory object rather than
            # refreshing it from the row this query just fetched -- so a
            # second run_ready_actions call (different request, different
            # session, waiting on the lock above) could still see an
            # action as "approved" and re-execute it even though the
            # first call already completed it in the database. Found via
            # empirical concurrent-approval testing (sprint 2 / audit H2)
            # -- two sibling actions approved concurrently produced two
            # execution_started events for the second one, back to back,
            # confirming the lock alone wasn't enough.
            all_actions = (
                await session.execute(
                    select(Action).where(Action.plan_id == plan.id).execution_options(populate_existing=True)
                )
            ).scalars().all()

            if any(a.status == "failed" for a in all_actions) and plan.status != "failed":
                # Reached on re-entry (e.g. approving a sibling step) after a
                # prior run already failed and returned — the actual error
                # message from that run was already recorded on plan.error then.
                plan.status = "failed"
                await session.commit()
                return

            if any(a.status == "denied" for a in all_actions):
                plan.status = "failed"
                plan.error = "a step was denied by policy"
                await session.commit()
                return

            completed_ids = {str(a.id) for a in all_actions if a.status == "completed"}
            ready = [
                a
                for a in all_actions
                if a.status == "approved" and all(dep in completed_ids for dep in a.depends_on)
            ]

            if not ready:
                break

            failure: str | None = None
            for action in ready:
                try:
                    await execute_action(session, action, plan, repo)
                except Exception as exc:  # noqa: BLE001 - also recorded on the action's event log
                    failure = f"{action.target or action.action_type}: {exc}"
                    break

            if failure is not None:
                plan.status = "failed"
                plan.error = failure
                await session.commit()
                return

        all_actions = (
            await session.execute(
                select(Action).where(Action.plan_id == plan.id).execution_options(populate_existing=True)
            )
        ).scalars().all()

        if all(a.status == "completed" for a in all_actions):
            plan.status = "completed"
        elif any(a.status == "pending" for a in all_actions):
            plan.status = "pending_approval"
        else:
            plan.status = "executing"
        await session.commit()
