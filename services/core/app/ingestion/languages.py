"""File-extension -> language mapping and lightweight framework detection
from marker files. Not an exhaustive classifier — good enough for Phase 2's
"detect languages/frameworks" scope.
"""

import json
import re
from pathlib import Path

EXTENSION_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".md": "markdown",
    ".mdx": "markdown",
    ".rst": "docs",
    ".txt": "docs",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".html": "html",
    ".css": "css",
    ".sql": "sql",
}

# Languages tree-sitter-language-pack can parse for us (Phase 2 scope: py/js/ts).
PARSEABLE_LANGUAGES = {"python", "javascript", "typescript"}

DOC_LANGUAGES = {"markdown", "docs"}

IGNORED_DIR_NAMES = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".turbo", "target", ".mypy_cache", ".pytest_cache", "coverage",
    ".data",  # local repo-clone storage (see app.config.settings.repos_dir)
}

_KNOWN_JS_FRAMEWORKS = {
    "react": "React",
    "next": "Next.js",
    "vue": "Vue",
    "svelte": "Svelte",
    "express": "Express",
    "fastify": "Fastify",
    "@nestjs/core": "NestJS",
    "reactflow": "React Flow",
}

_KNOWN_PY_FRAMEWORKS = {
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "sqlalchemy": "SQLAlchemy",
}


def detect_language(path: Path) -> str | None:
    return EXTENSION_LANGUAGE.get(path.suffix.lower())


def _is_ignored(path: Path, repo_root: Path) -> bool:
    return any(part in IGNORED_DIR_NAMES for part in path.relative_to(repo_root).parts)


def detect_frameworks(repo_root: Path) -> list[str]:
    """Scans the whole tree (not just root) since monorepos put package.json /
    requirements.txt under subdirectories like apps/web or services/core."""
    frameworks: set[str] = set()

    for package_json in repo_root.rglob("package.json"):
        if _is_ignored(package_json, repo_root):
            continue
        try:
            data = json.loads(package_json.read_text())
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            for key, label in _KNOWN_JS_FRAMEWORKS.items():
                if key in deps:
                    frameworks.add(label)
        except (json.JSONDecodeError, OSError):
            pass

    for pattern in ("requirements.txt", "pyproject.toml"):
        for f in repo_root.rglob(pattern):
            if _is_ignored(f, repo_root):
                continue
            try:
                text = f.read_text().lower()
                for key, label in _KNOWN_PY_FRAMEWORKS.items():
                    if re.search(rf"\b{re.escape(key)}\b", text):
                        frameworks.add(label)
            except OSError:
                pass

    if any(not _is_ignored(f, repo_root) for f in repo_root.rglob("go.mod")):
        frameworks.add("Go modules")
    if any(not _is_ignored(f, repo_root) for f in repo_root.rglob("Cargo.toml")):
        frameworks.add("Cargo")

    return sorted(frameworks)
