"""Thin GitHub API client: repo listing, webhook subscription, clone, and
(Phase 5) push + PR creation for the web UI adapter.

Phase 0 scope only — no persistence of tokens/repos yet (that lands with the
Phase 1 DB schema). Callers pass a user access token in directly.
"""

import re
import subprocess
from pathlib import Path

import httpx

API_BASE = "https://api.github.com"


async def list_repos(access_token: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{API_BASE}/user/repos",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            params={"per_page": 100},
        )
        resp.raise_for_status()
        return resp.json()


async def create_webhook(access_token: str, owner: str, repo: str, webhook_url: str, secret: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{API_BASE}/repos/{owner}/{repo}/hooks",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            json={
                "name": "web",
                "active": True,
                "events": ["push", "pull_request"],
                "config": {"url": webhook_url, "content_type": "json", "secret": secret},
            },
        )
        resp.raise_for_status()
        return resp.json()


def clone_repo(clone_url: str, dest_dir: Path) -> Path:
    """Full clone, not shallow — ownership detection and commit-message
    ingestion both read git log history, which a shallow (--depth 1) clone
    truncates to a single commit.

    clone_url is expected to already be validated (see schemas.py's
    RepoIngestRequest) by the time it reaches here, since every caller
    reads it from a stored Repository row created through that validated
    API. The '--' below is defense in depth regardless (sprint 1 / audit
    C5) — makes it unambiguous to git that what follows is positional
    arguments, not flags, even if something ever calls this directly."""
    dest_dir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--", clone_url, str(dest_dir)], check=True)
    return dest_dir


async def get_default_branch(clone_url: str, token: str = "") -> str:
    owner, repo = parse_owner_repo(clone_url)
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{API_BASE}/repos/{owner}/{repo}", headers=headers)
        resp.raise_for_status()
        return resp.json()["default_branch"]


def parse_owner_repo(clone_url: str) -> tuple[str, str]:
    match = re.search(r"github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?/?$", clone_url)
    if not match:
        raise ValueError(f"not a recognizable GitHub clone URL: {clone_url}")
    return match.group(1), match.group(2)


def push_branch(repo_dir: Path, branch: str, clone_url: str, token: str) -> None:
    """Pushes HEAD to `branch` on origin, authenticating with `token` for
    this single push only (the token is passed as a one-off remote URL, not
    written to the repo's persisted git config)."""
    owner, repo = parse_owner_repo(clone_url)
    authed_url = f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"
    subprocess.run(
        ["git", "push", authed_url, f"HEAD:refs/heads/{branch}"],
        cwd=str(repo_dir),
        check=True,
        capture_output=True,
        text=True,
    )


async def create_pull_request(
    token: str, clone_url: str, head_branch: str, base_branch: str, title: str, body: str
) -> dict:
    owner, repo = parse_owner_repo(clone_url)
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{API_BASE}/repos/{owner}/{repo}/pulls",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"title": title, "body": body, "head": head_branch, "base": base_branch},
        )
        resp.raise_for_status()
        return resp.json()
