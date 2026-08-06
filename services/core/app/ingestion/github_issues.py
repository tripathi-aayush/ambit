"""Fetches PR/issue text via GitHub's public REST API, unauthenticated.
Works for public repos only, capped at GitHub's unauthenticated rate limit
(60 requests/hour/IP) — no OAuth token is persisted anywhere in Orion yet
(see Phase 0/1 notes), so this is the ceiling until that's built.

GitHub's /issues endpoint returns both issues and PRs (a PR is a superset
of an issue in GitHub's data model) — one call gets both, which matters
given the tight rate limit.
"""

import re
from dataclasses import dataclass

import httpx

API_BASE = "https://api.github.com"
MAX_PAGES = 2
PER_PAGE = 50


@dataclass
class IssueEntry:
    source_type: str  # "pr" | "issue"
    number: int
    title: str
    body: str
    url: str


def parse_owner_repo(clone_url: str) -> tuple[str, str] | None:
    match = re.search(r"github\.com[:/]([^/]+)/([^/.]+?)(\.git)?/?$", clone_url)
    if not match:
        return None
    return match.group(1), match.group(2)


async def fetch_issues_and_prs(clone_url: str) -> list[IssueEntry]:
    parsed = parse_owner_repo(clone_url)
    if parsed is None:
        return []
    owner, repo = parsed

    entries: list[IssueEntry] = []
    async with httpx.AsyncClient() as client:
        for page in range(1, MAX_PAGES + 1):
            resp = await client.get(
                f"{API_BASE}/repos/{owner}/{repo}/issues",
                params={"state": "all", "per_page": PER_PAGE, "page": page},
                headers={"Accept": "application/vnd.github+json"},
                timeout=15,
            )
            if resp.status_code != 200:
                break
            items = resp.json()
            if not items:
                break

            for item in items:
                entries.append(
                    IssueEntry(
                        source_type="pr" if "pull_request" in item else "issue",
                        number=item["number"],
                        title=item["title"],
                        body=(item.get("body") or "").strip(),
                        url=item["html_url"],
                    )
                )

    return entries
