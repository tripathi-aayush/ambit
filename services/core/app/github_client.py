"""Thin GitHub API client: repo listing, webhook subscription, and clone.

Phase 0 scope only — no persistence of tokens/repos yet (that lands with the
Phase 1 DB schema). Callers pass a user access token in directly.
"""

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
    dest_dir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--depth", "1", clone_url, str(dest_dir)], check=True)
    return dest_dir
