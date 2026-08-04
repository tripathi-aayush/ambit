"""Basic code-ownership detection from git commit history — one pass over
`git log --name-only` rather than a subprocess per file."""

import subprocess
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

_COMMIT_PREFIX = "@@"


@dataclass
class OwnershipEntry:
    author_name: str
    author_email: str
    commit_count: int
    last_commit_at: datetime


def compute_ownership(repo_root: Path) -> dict[str, list[OwnershipEntry]]:
    """Returns {relative_file_path: [OwnershipEntry, ...]} sorted by commit_count desc."""
    try:
        result = subprocess.run(
            ["git", "log", f"--pretty=format:{_COMMIT_PREFIX}%an|%ae|%at", "--name-only"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return {}

    # file -> (author_name, author_email) -> [timestamps]
    per_file: dict[str, dict[tuple[str, str], list[int]]] = defaultdict(lambda: defaultdict(list))

    author: tuple[str, str] | None = None
    timestamp: int | None = None

    for line in result.stdout.splitlines():
        if line.startswith(_COMMIT_PREFIX):
            name, email, ts = line[len(_COMMIT_PREFIX) :].split("|")
            author = (name, email)
            timestamp = int(ts)
        elif line.strip() and author is not None:
            per_file[line.strip()][author].append(timestamp)

    ownership: dict[str, list[OwnershipEntry]] = {}
    for path, authors in per_file.items():
        entries = [
            OwnershipEntry(
                author_name=name,
                author_email=email,
                commit_count=len(timestamps),
                last_commit_at=datetime.fromtimestamp(max(timestamps), tz=timezone.utc),
            )
            for (name, email), timestamps in authors.items()
        ]
        entries.sort(key=lambda e: e.commit_count, reverse=True)
        ownership[path] = entries

    return ownership
