#!/usr/bin/env python3
"""Executes a single shell command inside an isolated, resource-limited
container on the inner (nested) Docker daemon.

Phase 0/1 scope: an arbitrary, untrusted command with no filesystem access
and no network (--network none) -- the general shell_exec case.

Phase 7 adds two opt-in escape hatches, used only for the "run the test
suite" step of a plan (never for general shell_exec): --workspace gives
the command a copy of a plan's working directory (bind-mounted into this
container at /plans, see docker-compose.yml), and --network lets pip/npm
reach the network to install dependencies. Both are still risk-scored and
policy-gated like any other action -- this isn't a new trust boundary,
just a different one from the fully-isolated default.

--workspace uses `docker create` + `docker cp`, not a live bind mount.
True nested DinD does not reliably propagate a bind-mount's actual file
content into containers created by the INNER daemon -- a well-documented
DinD limitation (the inner daemon's containers see mount *sources* through
its own graph-driver view, not a live view of the outer bind mount).
Docker-socket passthrough (Docker-outside-of-Docker) sidesteps this but
would give the sandboxed command root-equivalent host access, which
defeats the point of this container being --privileged with its own
isolated nested daemon in the first place. Copying files in/out keeps the
test container's isolation intact -- it never touches the host
filesystem, or even this container's filesystem, directly.

Usage (from the host, against the running sandbox container):
    docker exec <sandbox-container> python3 runner.py [options] "<shell command>"
"""

import argparse
import json
import subprocess

DEFAULT_IMAGE = "alpine:3.20"
DEFAULT_TIMEOUT = 60
WORKSPACE_TIMEOUT = 300  # dependency installs + test suites need more room


def _run_with_workspace(command: str, image: str, workspace: str, network: bool, timeout: int) -> dict:
    create = subprocess.run(
        [
            "docker", "create",
            "--network", "bridge" if network else "none",
            "--memory", "1g", "--cpus", "2", "--pids-limit", "512",
            "-w", "/workspace",
            image, "sh", "-c", command,
        ],
        capture_output=True, text=True, timeout=30,
    )
    if create.returncode != 0:
        return {"exit_code": 1, "stdout": "", "stderr": f"docker create failed: {create.stderr}"}
    container_id = create.stdout.strip()

    try:
        cp = subprocess.run(
            ["docker", "cp", f"{workspace}/.", f"{container_id}:/workspace"],
            capture_output=True, text=True, timeout=30,
        )
        if cp.returncode != 0:
            return {"exit_code": 1, "stdout": "", "stderr": f"docker cp (in) failed: {cp.stderr}"}

        try:
            result = subprocess.run(["docker", "start", "-a", container_id], capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return {"exit_code": 124, "stdout": "", "stderr": f"command timed out after {timeout}s"}
        return {"exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
    finally:
        subprocess.run(["docker", "rm", "-f", container_id], capture_output=True, text=True, timeout=15)


def _run_isolated(command: str, image: str, network: bool, timeout: int) -> dict:
    docker_args = ["docker", "run", "--rm", "--memory", "1g", "--cpus", "2", "--pids-limit", "512"]
    docker_args += ["--network", "bridge" if network else "none"]
    docker_args += [image, "sh", "-c", command]

    try:
        result = subprocess.run(docker_args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"exit_code": 124, "stdout": "", "stderr": f"command timed out after {timeout}s"}
    return {"exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


def run(command: str, image: str, workspace: str | None, network: bool, timeout: int) -> dict:
    if workspace:
        return _run_with_workspace(command, image, workspace, network, timeout)
    return _run_isolated(command, image, network, timeout)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--workspace", default=None, help="path under /plans to copy into the container's /workspace")
    parser.add_argument("--network", action="store_true", help="allow network access (default: none)")
    parser.add_argument("--timeout", type=int, default=None)
    args = parser.parse_args()

    timeout = args.timeout or (WORKSPACE_TIMEOUT if args.workspace else DEFAULT_TIMEOUT)
    print(json.dumps(run(args.command, args.image, args.workspace, args.network, timeout)))
