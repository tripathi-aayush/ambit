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

Orion Phase 2 (live runtime): this script streams one NDJSON line per
output line to its own stdout as the target command runs --
{"type": "output", "stream": "stdout"|"stderr", "line": "..."} -- ending
with {"type": "result", "exit_code": N}, instead of the old single
end-of-run JSON blob. services/core's executor.py reads this stream
incrementally so output shows up live, not only once the whole command
finishes. Every print here uses flush=True deliberately -- Python fully
buffers stdout by default when it isn't a TTY (which a docker-exec pipe
never is), so without an explicit flush every line would sit in this
process's internal buffer and only reach the reader on the other end of
the pipe once that buffer fills or the process exits, silently defeating
the entire point of streaming.

Usage (from the host, against the running sandbox container):
    docker exec <sandbox-container> python3 runner.py [options] "<shell command>"
"""

import argparse
import json
import queue
import subprocess
import threading
import time

DEFAULT_IMAGE = "alpine:3.20"
DEFAULT_TIMEOUT = 60
WORKSPACE_TIMEOUT = 300  # dependency installs + test suites need more room


def _emit(msg: dict) -> None:
    print(json.dumps(msg), flush=True)


def _emit_output(stream: str, line: str) -> None:
    _emit({"type": "output", "stream": stream, "line": line})


def _stream_process(popen: subprocess.Popen, timeout: int) -> int:
    """Reads stdout/stderr concurrently via two reader threads + a shared
    queue -- the standard correct pattern for draining two pipes at once
    without risking a deadlock (reading one stream to completion before
    touching the other blocks forever if the other's OS pipe buffer fills
    up first). Emits one "output" NDJSON line per line of output, in
    receipt order, as it arrives. Returns the process's exit code; kills
    it and raises TimeoutError if `timeout` elapses first."""
    q: "queue.Queue[tuple[str, str | None]]" = queue.Queue()

    def reader(stream, name: str) -> None:
        try:
            for line in iter(stream.readline, ""):
                q.put((name, line.rstrip("\n")))
        finally:
            q.put((name, None))  # sentinel: this stream has hit EOF
            stream.close()

    threads = [
        threading.Thread(target=reader, args=(popen.stdout, "stdout"), daemon=True),
        threading.Thread(target=reader, args=(popen.stderr, "stderr"), daemon=True),
    ]
    for t in threads:
        t.start()

    done_streams = 0
    deadline = time.monotonic() + timeout
    while done_streams < 2:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            popen.kill()
            raise TimeoutError(f"command timed out after {timeout}s")
        try:
            name, line = q.get(timeout=min(remaining, 1.0))
        except queue.Empty:
            continue
        if line is None:
            done_streams += 1
            continue
        _emit_output(name, line)

    for t in threads:
        t.join(timeout=5)
    return popen.wait()


def _run_with_workspace(command: str, image: str, workspace: str, network: bool, timeout: int) -> int:
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
        _emit_output("stderr", f"docker create failed: {create.stderr}")
        return 1
    container_id = create.stdout.strip()

    try:
        cp = subprocess.run(
            ["docker", "cp", f"{workspace}/.", f"{container_id}:/workspace"],
            capture_output=True, text=True, timeout=30,
        )
        if cp.returncode != 0:
            _emit_output("stderr", f"docker cp (in) failed: {cp.stderr}")
            return 1

        popen = subprocess.Popen(
            ["docker", "start", "-a", container_id],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
        )
        try:
            return _stream_process(popen, timeout)
        except TimeoutError:
            _emit_output("stderr", f"command timed out after {timeout}s")
            return 124
    finally:
        subprocess.run(["docker", "rm", "-f", container_id], capture_output=True, text=True, timeout=15)


def _run_isolated(command: str, image: str, network: bool, timeout: int) -> int:
    docker_args = ["docker", "run", "--rm", "--memory", "1g", "--cpus", "2", "--pids-limit", "512"]
    docker_args += ["--network", "bridge" if network else "none"]
    docker_args += [image, "sh", "-c", command]

    popen = subprocess.Popen(docker_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        return _stream_process(popen, timeout)
    except TimeoutError:
        _emit_output("stderr", f"command timed out after {timeout}s")
        return 124


def run(command: str, image: str, workspace: str | None, network: bool, timeout: int) -> int:
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
    exit_code = run(args.command, args.image, args.workspace, args.network, timeout)
    _emit({"type": "result", "exit_code": exit_code})
