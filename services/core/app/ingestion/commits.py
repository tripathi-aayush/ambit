"""Extracts commit messages from git log for RAG retrieval — one
repo_chunks row per commit (subject + body), embedded like code chunks."""

import subprocess
from dataclasses import dataclass
from pathlib import Path

MAX_COMMITS = 200

FIELD_SEP = "\x1f"
RECORD_SEP = "\x1e"


@dataclass
class CommitEntry:
    sha: str
    subject: str
    body: str
    author_name: str


def get_recent_commits(repo_root: Path, limit: int = MAX_COMMITS) -> list[CommitEntry]:
    try:
        result = subprocess.run(
            [
                "git", "log", f"-n{limit}",
                f"--format=%H{FIELD_SEP}%an{FIELD_SEP}%s{FIELD_SEP}%b{RECORD_SEP}",
            ],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []

    commits = []
    for record in result.stdout.split(RECORD_SEP):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split(FIELD_SEP)
        if len(parts) != 4:
            continue
        sha, author, subject, body = parts
        commits.append(CommitEntry(sha=sha, subject=subject, body=body.strip(), author_name=author))

    return commits
