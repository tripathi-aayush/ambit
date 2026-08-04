#!/usr/bin/env python3
"""Executes a single shell command inside an isolated, resource-limited
container on the inner (nested) Docker daemon.

Phase 0 scope: prove the isolation primitive works. Phase 1 wires this up to
the policy/risk pipeline instead of calling it directly.

Usage (from the host, against the running sandbox container):
    docker exec <sandbox-container> python3 runner.py "<shell command>" [image]
"""

import json
import subprocess
import sys

DEFAULT_IMAGE = "alpine:3.20"


def run(command: str, image: str = DEFAULT_IMAGE) -> dict:
    result = subprocess.run(
        [
            "docker", "run", "--rm",
            "--network", "none",
            "--memory", "512m",
            "--cpus", "1",
            "--pids-limit", "128",
            image,
            "sh", "-c", command,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: runner.py '<command>' [image]"}))
        sys.exit(1)
    cmd = sys.argv[1]
    img = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_IMAGE
    print(json.dumps(run(cmd, img)))
