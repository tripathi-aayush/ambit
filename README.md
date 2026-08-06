# Ambit

A runtime/policy engine for AI coding agents — not a demo wrapper around an LLM, but a governance layer every agent action passes through: **risk score → policy check → approval (if required) → sandboxed execution → audit trail**, with rollback and reporting built on the same event log.

Every write an agent makes (file edit, git commit, git push, shell command) is modeled as an **Action Object** that flows through one shared pipeline, regardless of which adapter submitted it. The pitch: adding support for a new agent is a new thin adapter over an existing runtime, not a rewrite.

## What's built

The full plan spans 9 phases (`PROJECT_PLAN.md`); this repo currently implements Phases 0–8 for a single adapter:

| Phase | What it is | Status |
|---|---|---|
| 0 | Monorepo scaffolding, Docker-in-Docker sandbox, Postgres+pgvector | Done |
| 1 | Action Object schema, risk scorer, OPA policy, approval flow, event log | Done |
| 2 | Repo ingestion: clone, parse (tree-sitter), dependency graph, embeddings, LLM file summaries | Done |
| 3 | Repository chat (RAG over code + commits + PRs/issues, source citations) | Done |
| 4 | Auto-generated architecture docs: dependency graph, README, sequence diagram | Done |
| 5 | **Web UI adapter**: task → LLM-planned DAG of Action Objects → sandboxed execution → PR | Done |
| 6 | Audit timeline, diff view, per-action rollback (generates a revert PR) | Done |
| 7 | Test generation + sandboxed test runs that block PR creation on failure | Done |
| 8 | Polish, analytics dashboard, production-readiness fixes | Done |

**Scope note:** the original plan calls for three adapters (Web UI, Claude Code hooks+MCP, a generic CLI wrapper) sharing the same runtime core. Only the Web UI adapter is built — Claude Code and CLI wrapper adapters were deliberately deferred, not abandoned. The runtime core (Phase 1) is adapter-agnostic by construction specifically so that remains true: a new adapter is new code that calls the same `submit_action()` pipeline, not a change to it.

## Architecture

```
apps/web          Next.js 16 (App Router) — chat, architecture viewer, task/DAG UI, timeline, analytics
services/core      FastAPI (Python) — ingestion, RAG, planner, risk/policy pipeline, executor
infra/opa          Rego policy rules the risk/policy pipeline evaluates against
infra/sandbox      Docker-in-Docker container — isolated execution for agent-authored shell commands
```

Postgres (with pgvector) is the only datastore — structural data (files, symbols, dependency graph, actions, events, approvals, plans) and embeddings live in the same database.

**Why a real sandbox, not just subprocess calls:** `shell_exec` steps run genuinely untrusted, LLM-authored commands. They execute inside `infra/sandbox`, a `--privileged` container running its own nested Docker daemon, isolated with `--network none` by default (test-run steps get network access to install dependencies, still risk-scored and policy-gated like everything else — not a separate trust boundary). File writes/commits/pushes are structured and already mediated by the Action Object + policy check, so they run directly against a per-plan git clone.

## Running it

```bash
cp services/core/.env.example services/core/.env    # fill in AMBIT_API_KEY, LLM_PROVIDER + one API key -- see Authentication below
cp apps/web/.env.local.example apps/web/.env.local   # fill in NEXT_PUBLIC_AMBIT_API_KEY -- must match AMBIT_API_KEY exactly
docker compose up -d                                 # postgres, opa, sandbox, core
cd apps/web && npm install && npm run dev             # localhost:3000
```

Open `localhost:3000` once both are running. The page's first action is `GET /repos`, which should return an empty list on a fresh install. If you instead see a failed request in the UI, see Authentication below.

`GITHUB_TOKEN` (a PAT with `repo` scope) is required for the Web UI adapter to push branches and open PRs — without it, plans execute up through `git_commit` and then fail cleanly at `git_push` with a clear error, rather than silently no-op'ing.

Core also runs directly via `uvicorn app.main:app --reload` from `services/core` for faster local iteration — `docker compose up` is the way to verify the full containerized stack, including the sandbox's Docker-outside-of-Docker access into `core`'s container.

## Authentication

Every request to `services/core` must carry an `X-Ambit-Key` header matching `AMBIT_API_KEY`. This is a shared-secret gate added during hardening work ahead of v1.0 — earlier builds had no auth at all, so anything that could reach the core service's port could submit or approve actions. It's one shared secret for a single trusted operator, not per-user accounts or multi-tenant auth.

Two files need the **same** value:

- `services/core/.env` — `AMBIT_API_KEY=<value>`. Generate one with `openssl rand -hex 32` (or any comparably random string).
- `apps/web/.env.local` — `NEXT_PUBLIC_AMBIT_API_KEY=<the same value>`. The frontend sends this as `X-Ambit-Key` on every request to core.

What each misconfiguration looks like, so it's recognizable if you hit it:

| Situation | What happens |
|---|---|
| `AMBIT_API_KEY` unset/empty in `services/core/.env` | Every request gets `500 AMBIT_API_KEY is not configured on the server`, including requests from the frontend. Set it and recreate the container — compose does not pick up `.env` edits on a running container: `docker compose up -d --force-recreate core`. |
| `NEXT_PUBLIC_AMBIT_API_KEY` unset in `apps/web/.env.local` | The UI loads, but every API call fails with `401 missing X-Ambit-Key header`. Restart `npm run dev` after setting it — Next.js reads `NEXT_PUBLIC_*` vars at build/start time. |
| The two values are set but don't match | Every API call fails with `403 invalid X-Ambit-Key`. Copy the value from `services/core/.env` into `apps/web/.env.local` exactly — no quotes, no trailing whitespace. |
| Both set and matching | Requests succeed normally. First successful call on a fresh install is `GET /repos` → `[]`. |

`NEXT_PUBLIC_*` variables are compiled into the browser's JS bundle and are visible to anyone with devtools open on that page. That's an accepted tradeoff for "one operator running their own private instance," not a real secret boundary — don't reuse this key anywhere it needs to resist a hostile browser user.

## Key design decisions worth knowing about

- **Risk scoring is deterministic, not learned** (`app/risk.py`): a fixed set of additive rules over action type, target path, branch, and environment. No ML — every score comes with human-readable reasons, and the same input always produces the same score.
- **Policy is OPA/Rego** (`infra/opa/policies/ambit.rego`), not hand-rolled — direct commits to `main`, prod database migrations, and prod shell execution all require approval by policy, independent of the risk score.
- **Rollback re-uses the forward pipeline.** Reverting an action builds a new mini-plan (restore old content → commit → push → fresh PR) and submits it through the exact same risk/policy pipeline as any other change — restoring a deleted prod file is exactly the kind of thing that should still be reviewable, not bypassed because it's technically an "undo."
- **A test failure blocks PR creation for free.** The executor halts an entire plan on any step's failure (built for Phase 6's audit trail); Phase 7 just inserts a test-run step into the dependency chain ahead of `git_commit`, so "block PR creation on failure" falls out of existing behavior rather than needing new logic.
- **PR descriptions are generated deterministically**, not by another LLM call — they're a factual summary (steps, risk scores, approval trail, test outcome) built from data already on the Action/Approval rows.

## Known limitations

- **Single adapter.** See the scope note above.
- **Full-file regeneration risk.** `file_write` steps have the model output a file's complete new content rather than a diff. For large files this occasionally causes incidental changes to unrelated formatting (observed: collapsed blank lines, a dropped trailing newline) alongside the intended edit. Always reviewable in the diff view before merging.
- **LLM path/command grounding isn't 100% reliable.** The planner sometimes gets a subdirectory path or test-run command wrong on repos with nested package layouts, even with explicit prompting. The safety-critical half of this — detecting and blocking on any such failure before it reaches a PR — is fully robust; it just means test generation occasionally needs a second attempt.
- **The sandbox's default image has no language runtime.** `shell_exec` steps default to `alpine:3.20`; the planner sets an appropriate image (`python:3.12-slim`, `node:20-slim`) for test-run steps specifically, but arbitrary one-off commands may need one specified too.

## Repo layout

```
apps/web/src/app/                    Next.js routes (App Router)
  page.tsx                           repo list + ingest
  repos/[id]/page.tsx                chat
  repos/[id]/architecture/page.tsx   architecture doc + dependency graph
  repos/[id]/tasks/page.tsx          task input + DAG + approvals
  timeline/page.tsx                  global action timeline + diff + rollback
  analytics/page.tsx                 acceptance rate / rollback frequency / risk distribution

services/core/app/
  risk.py, policy.py, pipeline.py    Phase 1 runtime core
  ingestion/                         Phase 2 repo ingestion
  rag.py                             Phase 3 chat
  architecture.py                    Phase 4 doc generation
  planner.py, executor.py            Phase 5/7 plan generation + execution
  rollback.py, pr_description.py     Phase 6/7
  api/analytics.py                   Phase 8
```
