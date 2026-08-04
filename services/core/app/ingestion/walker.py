"""Clone (via app.github_client) and walk a repository, detecting per-file
language and repo-level frameworks.
"""

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.github_client import clone_repo
from app.ingestion.languages import IGNORED_DIR_NAMES, detect_frameworks, detect_language

MAX_FILE_SIZE_BYTES = 1_000_000  # skip anything bigger — unlikely to be source we care about


@dataclass
class WalkedFile:
    path: str  # relative to repo root
    language: str | None
    size_bytes: int
    content_hash: str
    content: str


def clone_for_ingestion(clone_url: str) -> Path:
    dest = Path(settings.repos_dir) / str(uuid.uuid4())
    return clone_repo(clone_url, dest)


def walk_repo(repo_root: Path) -> tuple[list[WalkedFile], list[str]]:
    files: list[WalkedFile] = []

    for path in sorted(repo_root.rglob("*")):
        if not path.is_file():
            continue
        if any(part in IGNORED_DIR_NAMES for part in path.relative_to(repo_root).parts):
            continue
        if path.stat().st_size > MAX_FILE_SIZE_BYTES:
            continue

        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable — skip

        language = detect_language(path)
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        files.append(
            WalkedFile(
                path=str(path.relative_to(repo_root)),
                language=language,
                size_bytes=path.stat().st_size,
                content_hash=content_hash,
                content=content,
            )
        )

    frameworks = detect_frameworks(repo_root)
    return files, frameworks
