// Resolves "which Orion repository does the current directory mean" the
// same way git/gh/vercel do: read the cwd's git remote, no --repo flag
// needed in the common case. If Orion doesn't recognize the remote yet,
// this drives the explicit "not connected yet -- ingest now?" flow rather
// than silently registering it -- ingestion isn't free (clones + runs
// embeddings/LLM summarization over every file), and "no surprises" has
// been the product's own principle since its first tagline.

import { execSync } from "node:child_process";
import pc from "picocolors";
import { createRepo, getRepo, listRepos, type Repository } from "./client";
import { promptYesNo } from "./prompt";

function getGitRemoteUrl(): string | null {
  try {
    return execSync("git remote get-url origin", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Normalizes both SSH (git@github.com:owner/repo.git) and HTTPS forms to
// the plain https://github.com/owner/repo shape the backend's
// GITHUB_HTTPS_URL_RE allowlist expects (services/core/app/schemas.py).
function normalizeGithubUrl(remote: string): string | null {
  const ssh = remote.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  const https = remote.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;
  return null;
}

export class NoGitRemoteError extends Error {
  constructor() {
    super("No git remote found. Run this from inside a repository with a GitHub 'origin' remote.");
  }
}

export class UnrecognizedRepoError extends Error {
  constructor(public readonly cloneUrl: string) {
    super(`${cloneUrl} isn't connected to Orion yet. Run \`orion link\` to connect it.`);
  }
}

async function findRepoByCloneUrl(cloneUrl: string): Promise<Repository | null> {
  const repos = await listRepos();
  return repos.find((r) => r.clone_url.replace(/\.git\/?$/, "") === cloneUrl.replace(/\.git\/?$/, "")) ?? null;
}

/** Non-interactive resolution: used by commands that must fail clearly
 * rather than prompt (e.g. scripted/CI use). Throws if unrecognized. */
export async function resolveRepo(): Promise<Repository> {
  const remote = getGitRemoteUrl();
  if (!remote) throw new NoGitRemoteError();
  const cloneUrl = normalizeGithubUrl(remote);
  if (!cloneUrl) throw new Error(`Remote "${remote}" isn't a github.com repository -- Orion only supports those today.`);
  const repo = await findRepoByCloneUrl(cloneUrl);
  if (!repo) throw new UnrecognizedRepoError(cloneUrl);
  return repo;
}

/** Interactive resolution: used by orion link, and by plan/implement/
 * status/review when run directly against an unconnected repo -- prompts
 * before ingesting, never silently registers. */
export async function resolveOrLinkRepo(): Promise<Repository> {
  const remote = getGitRemoteUrl();
  if (!remote) throw new NoGitRemoteError();
  const cloneUrl = normalizeGithubUrl(remote);
  if (!cloneUrl) throw new Error(`Remote "${remote}" isn't a github.com repository -- Orion only supports those today.`);

  const existing = await findRepoByCloneUrl(cloneUrl);
  if (existing) return existing;

  const proceed = await promptYesNo(`${pc.bold(cloneUrl)} isn't connected to Orion yet. Ingest it now?`);
  if (!proceed) throw new Error("Not connected. Run `orion link` when you're ready.");

  console.log(pc.dim("Ingesting…"));
  let repo = await createRepo(cloneUrl);
  while (repo.status === "pending" || repo.status === "processing") {
    await new Promise((r) => setTimeout(r, 2000));
    repo = await getRepo(repo.id);
  }
  if (repo.status === "failed") {
    throw new Error(`Ingestion failed: ${repo.error ?? "unknown error"}`);
  }
  console.log(pc.green(`✓ Connected ${repo.name}`));
  return repo;
}
