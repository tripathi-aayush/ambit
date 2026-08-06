# Ambit — Production Readiness Audit

**Date:** 2026-08-05
**Scope:** Full codebase (`apps/web`, `services/core`, `infra/`), all phases 0–8, static review + live empirical testing against the running stack.
**Method:** Every finding below marked **[Empirically verified]** was reproduced against the actual running system (not inferred from reading code alone) — see the Repro steps. Findings without that marker are high-confidence static findings where live reproduction wasn't attempted (usually because doing so safely wasn't practical) but the reasoning is traced to exact line numbers.

No code was changed to produce this report. Test artifacts created during verification (a handful of test repos/plans in the dev DB, no production data exists) were cleaned up where possible; a couple of orphaned rows remain and are harmless (see Critical #3's repro notes).

---

## Summary

| Severity | Count |
|---|---|
| Critical | 5 |
| High | 6 |
| Medium | 8 |
| Low | 4 |

The single biggest theme: **Ambit's core value proposition — that risky agent actions are risk-scored, policy-gated, and require human approval before executing — has multiple ways to be bypassed or silently broken.** No authentication exists on any endpoint, the policy engine defaults to allow, the two most common action types (`file_write`/`file_delete`) have zero policy rules at all, and the approval-decision endpoint has a real, reproduced race condition that let two contradictory decisions both silently succeed. Every one of these is fixable without a rewrite, but they should be treated as blocking for any deployment beyond "runs on my own laptop, only I can reach port 8000."

---

## Critical

### C1 — No authentication or authorization on any endpoint
**Severity:** Critical
**Why it's a problem:** Ambit's entire pitch is that agent actions are governed — risk-scored, policy-checked, and gated behind human approval. Every single API endpoint (`POST /actions`, `POST /approvals/{id}`, `POST /repos/{id}/plans`, `POST /actions/{id}/rollback`, etc.) is reachable by anyone who can send an HTTP request to port 8000, with zero credential check. Anyone who can reach the service can: approve/deny any pending action (including ones flagged high-risk), submit arbitrary task plans that execute code and push to GitHub using the server's PAT, trigger rollbacks, and read the full audit history. The governance model is entirely a UI convention, not an enforced boundary — an attacker (or a misconfigured reverse proxy exposing this beyond localhost) bypasses it by skipping the UI.
**Root cause:** No auth middleware, no API key/session dependency was ever added to any router. The one OAuth flow that exists (`app/api/github.py`) is a disconnected Phase-0 stub (see C-adjacent finding under Medium — "dead OAuth stub") that doesn't gate anything.
**Files/modules:** `services/core/app/main.py` (no auth middleware registered), every file in `services/core/app/api/`.
**How to reproduce:** [Empirically verified] Every test in this audit — including submitting plans, approving/denying actions, and triggering rollbacks — was done via plain `curl` with no credentials of any kind, all session-long, against the real running stack.
**Recommended fix:** At minimum, a shared-secret API key (`X-Ambit-Key` header checked via a FastAPI dependency on every router) before v1.0. Longer-term, the already-scaffolded GitHub OAuth flow should actually gate access, with per-user session tracking so the audit trail's `actor_user`/`approver` fields mean something (right now `approver` is a free-text string the caller supplies themselves with no verification — see C3 for how this compounds).
**Risk of fixing:** Low-medium. Adding an auth dependency is additive and mechanical, but touches every route file and needs the frontend's `api.ts` to send credentials — a coordinated but not risky change.

---

### C2 — Path traversal in `file_write`/`file_delete` execution
**Severity:** Critical
**Why it's a problem:** A plan step's `target` (file path) is joined directly onto the plan's working directory with no validation that the result stays inside it. Both `../../` relative traversal and a bare absolute path completely escape the sandboxed clone directory, letting a write land anywhere the `core` process's filesystem permissions allow — inside the container, that includes anything mounted into it.
**Root cause:** `target = wd / action.target` uses Python's `pathlib` `/` operator, which (a) does not collapse `..` segments before use, and (b) *replaces* the left-hand path entirely if the right-hand operand is absolute — neither behavior is guarded against.
**Files/modules:** `services/core/app/executor.py` — `_run_action()`, the `file_write` branch (`target = wd / action.target`) and `file_delete` branch (identical pattern).
**How to reproduce:** [Empirically verified]
```python
from pathlib import Path
wd = Path("/tmp/ambit_audit_test/fake_plan_root")
target = wd / "../../../../../tmp/ambit_audit_test/ESCAPED_relative.txt"
target.write_text("escaped via relative traversal")   # lands at /tmp/ambit_audit_test/ESCAPED_relative.txt, outside wd
target2 = wd / "/tmp/ambit_audit_test/ESCAPED_absolute.txt"
target2.write_text("escaped via absolute override")   # wd is silently discarded entirely
```
Both files were written and confirmed on disk outside the intended directory in this session.
**Exploitability today:** requires `action.target` to be attacker-influenced. The normal path is LLM-generated (via `planner.py`), so this needs prompt injection (e.g. a malicious file in an ingested repo instructing the model to write outside the repo) rather than direct API control — `POST /actions` accepts an arbitrary `target` but (per current design) never gets executed since it has no `plan_id`. That's a fragile safety margin to rely on, not a real boundary, especially combined with C1 (no auth) and the fact prompt injection against the planner was never specifically tested/hardened against.
**Recommended fix:** After joining, resolve both paths and assert `target.resolve().is_relative_to(wd.resolve())`; reject the action with a clear error otherwise. Apply identically to `file_delete`.
**Risk of fixing:** Very low. Additive validation, no behavior change for any legitimate (non-traversal) target.

---

### C3 — TOCTOU race condition in the approval-decision endpoint
**Severity:** Critical
**Why it's a problem:** Two concurrent decisions on the same pending action (e.g. a double-click, two reviewers acting at once, or a retried request) can **both succeed**, producing two contradictory `Approval` rows and a non-deterministic final status decided by whichever commit lands last — with **no error returned to either caller**. This corrupts the audit trail (which is supposed to be the trustworthy record of who decided what) and, worse, can double-trigger downstream plan execution.
**Root cause:** `services/core/app/api/approvals.py`'s `decide()` reads the action's status, checks it in Python (`if action.status != "pending": raise 409`), and only *then* writes the new status — with no row lock (`SELECT ... FOR UPDATE`), no optimistic concurrency check (e.g. `UPDATE ... WHERE status = 'pending'`), and no application-level lock.
**Files/modules:** `services/core/app/api/approvals.py` (`decide()`), `services/core/app/pipeline.py` (`decide_approval()`).
**How to reproduce:** [Empirically verified]
```bash
# Two truly concurrent requests against the same pending action:
curl -X POST http://localhost:8000/approvals/<action_id> -d '{"approver":"alice","decision":"approved"}' &
curl -X POST http://localhost:8000/approvals/<action_id> -d '{"approver":"bob","decision":"denied"}' &
wait
```
Result this session: **both requests returned HTTP 200** (neither got the expected 409). DB confirmed two `Approval` rows for the one action:
```
 approver | decision
----------+----------
 alice    | approved
 bob      | denied
```
Final action status silently became "denied" — alice's decision was recorded but overwritten with no indication to her that it didn't take effect.
**Recommended fix:** Make the status transition atomic: `UPDATE actions SET status = :decision WHERE id = :id AND status = 'pending' RETURNING *`, and return 409 if zero rows were updated (SQLAlchemy: use `session.execute(update(...).where(...).returning(...))` instead of get-then-set). Do this inside the same transaction as the `Approval` insert.
**Risk of fixing:** Low. This tightens an existing check, doesn't change the happy path.

---

### C4 — Policy engine defaults to allow; `file_write`/`file_delete` have zero policy rules
**Severity:** Critical
**Why it's a problem:** The OPA policy (`infra/opa/policies/ambit.rego`) opens with `default allow := true` and `default require_approval := false` — a default-*allow* posture, not default-*deny*. Combined with there being **no Rego rule at all** for `file_write` or `file_delete` (the two most common action types a coding agent produces), these actions are *never* policy-gated in any environment, regardless of target path sensitivity. The only gate left is `risk.py`'s additive risk score, and that score can plausibly stay under the 70-point "high" threshold for genuinely risky combinations — e.g. a `file_write` to a `.env`/`secrets/` path in `dev` scores `5 (base) + 25 (sensitive path) = 30`, which is "low" risk (`<35`) and auto-executes with no human review at all. Deleting a file in `prod` scores `20 (elevated) + 40 (prod) = 60`, "medium," also auto-executes.
**Root cause:** The Rego policy was written to cover the scenarios explicitly named in the Phase 1 plan (protected-branch commits/pushes, prod db_migration, prod shell_exec) but was never extended as new action types (`file_write`/`file_delete`, added in Phase 5) were introduced — and the fallback for anything not covered is "allow," not "require review."
**Files/modules:** `infra/opa/policies/ambit.rego`, `services/core/app/risk.py` (score thresholds), `services/core/app/policy.py` (`.get("allow", True)` — a second, redundant fail-open default on the Python side, though in practice OPA's own `default` already guarantees the key is present for any reachable input, so this rarely triggers independently — see C4 repro for the one case where it does).
**How to reproduce:** [Empirically verified — OPA-unreachable case] Stopping the `opa` container and submitting an action produces an HTTP 500 (connection failure raises before `policy.py`'s Python-side default is reached) — this fails the *request*, but fails it for **every** action indiscriminately (total outage, not a graduated response), rather than fail-closed-with-a-clear-message for just that one decision. [Reasoned, not separately reproduced] The sensitive-path/dev-environment and file-delete/prod-environment scoring gaps above are direct arithmetic from `risk.py`'s published constants, cross-checked against the Rego file's actual rule set (pasted above in full) — there is no rule matching `input.action_type == "file_write"` or `"file_delete"` anywhere in that file.
**Recommended fix:**
1. Add explicit Rego rules requiring approval for `file_write`/`file_delete` against sensitive path patterns (mirror `risk.py`'s `SENSITIVE_TARGET_PATTERNS`) and for `file_delete` in `prod`, independent of the risk score.
2. Consider flipping the default posture for prod specifically: `require_approval := true if input.environment == "prod"` unless explicitly exempted, rather than opt-in per action type.
3. Handle OPA-unreachable explicitly in `policy.py` (catch `httpx.HTTPError`) and decide deliberately whether that should deny-and-log or fail the request with a clear "policy engine unavailable" message — right now it's an accidental crash, not a decision.
**Risk of fixing:** Low for the Rego additions (additive rules). Slightly higher for changing OPA-down behavior since it changes what happens to in-flight submissions during an outage — worth a deliberate decision with the user, not a silent change.

---

### C5 — `clone_url` passed unsanitized to `git clone` (argument injection)
**Severity:** Critical
**Why it's a problem:** `POST /repos` accepts `clone_url` as a completely unvalidated string (no scheme allowlist, no rejection of leading dashes) and passes it directly as a positional argument to `git clone` with no `--` separator. Git interprets a string starting with `-` as a flag, not a URL — this is a well-documented class of vulnerability (git argument injection). Flags like `--upload-pack=<cmd>` or the `ext::` transport helper have historically been used to achieve command execution via crafted "URLs" passed to `git clone`.
**Root cause:** `create_pending_repository()` stores `clone_url` verbatim with no validation; `github_client.clone_repo()` passes it straight into `subprocess.run(["git", "clone", clone_url, str(dest_dir)])`.
**Files/modules:** `services/core/app/ingestion/pipeline.py` (`create_pending_repository`), `services/core/app/github_client.py` (`clone_repo`), `services/core/app/schemas.py`/`app/api/repos.py` (`RepoIngestRequest.clone_url: str`, no validator).
**How to reproduce:** [Empirically verified — passthrough confirmed, stopped short of full RCE]
```bash
curl -X POST http://localhost:8000/repos -d '{"clone_url": "--upload-pack=touch /tmp/PWNED"}'
```
Repo record was created (`name` even got derived as `"PWNED_via_git_arg_injection"` from the string, confirming zero sanitization anywhere in the pipeline). Ingestion failed with:
```
Command '['git', 'clone', '--upload-pack=touch /tmp/...', '/data/repos/...']' returned non-zero exit status 128.
```
This confirms git received and attempted to parse the string as a flag. I deliberately did not attempt a working `ext::`-transport RCE payload — that crosses from verifying the vulnerability class into actually exploiting it, and isn't necessary to establish the finding; whether it fully achieves code execution on a given deployment depends on that git install's `protocol.ext.allow` setting, but the unsanitized passthrough itself is the vulnerability regardless.
**Recommended fix:** Validate `clone_url` against an allowlist (must start with `https://github.com/` or `git@github.com:`, reject anything else including `file://`, `ext::`, and anything starting with `-`). Additionally pass `--` before the URL argument in the `git clone` invocation as defense in depth.
**Risk of fixing:** Low. Legitimate GitHub HTTPS URLs are unaffected; this only rejects malformed/malicious input that was never a supported use case anyway.

---

## High

### H1 — Blocking subprocess/git calls never offloaded from the event loop
**Severity:** High
**Why it's a problem:** `core` runs as a single-process, single-event-loop `uvicorn` server (no `--workers`, confirmed in the Dockerfile `CMD`). Every git operation in plan execution and ingestion — clone, checkout, add, commit, push, and the `docker exec` calls into the sandbox (which can run for up to 300s for test-run steps) — uses plain `subprocess.run()` called directly from `async def` functions, with no `asyncio.to_thread()` wrapper. This blocks the *entire* event loop for the duration: while one plan is executing (or one repo is being cloned for ingestion), **no other request of any kind can be served** — not a health check, not a simple `GET /repos`, nothing — until it finishes. A single slow test-run step can freeze the whole API for up to 5 minutes.
**Root cause:** The embedding/LLM calls were correctly wrapped in `asyncio.to_thread` earlier in the project (a fix applied specifically for this reason), but the pattern wasn't applied to the git/subprocess layer added in later phases.
**Files/modules:** `services/core/app/executor.py` (`_ensure_working_dir`, all of `_run_action`'s git_commit/git_push branches, `_run_in_sandbox`), `services/core/app/github_client.py` (`clone_repo`, `push_branch`), `services/core/app/ingestion/pipeline.py` (`clone_for_ingestion` call, line ~152).
**How to reproduce:** Not separately reproduced live (would require orchestrating a slow concurrent request during a long-running plan), but directly confirmable by reading: every listed call site uses `subprocess.run` with no thread offload, and `grep -n "async def\|^def " app/executor.py` shows `_ensure_working_dir`/`_run_in_sandbox` are synchronous functions called directly (not awaited-via-thread) from the async `execute_action`/`_run_action`.
**Recommended fix:** Wrap every blocking call site in `await asyncio.to_thread(...)`, same pattern already used for embeddings. This compounds with C3's race condition — under concurrent load, blocking the loop makes the race window *larger*, not just slower.
**Risk of fixing:** Low-medium. Mechanical change, but every call site needs to be found and converted correctly (missing one defeats the purpose) — worth a systematic pass, not one-off patches.

### H2 — No locking around plan execution enables duplicate side effects
**Severity:** High
**Why it's a problem:** `run_ready_actions()` has no mutual exclusion. If two concurrent triggers both observe the same action as `status == "approved"` with satisfied dependencies (plausible via the H1 blocking-loop issue compounding request timing, or via C3's approval race if both racing decisions happen to be "approved"), both can call `execute_action()` on the same action. For `git_push`, this risks two concurrent pushes/PR-creation attempts on the same branch; for `file_write`, the *second* execution would capture the *first* execution's output as `previous_content`, silently corrupting the diff view and rollback data for that action.
**Root cause:** Same missing-lock root cause as C3, but on the execution side rather than the approval-decision side.
**Files/modules:** `services/core/app/executor.py` (`run_ready_actions`, `execute_action`).
**How to reproduce:** Not independently reproduced (would require winning a tight timing race); flagged based on direct code reading — no lock, mutex, or `SELECT FOR UPDATE` exists anywhere in this path.
**Recommended fix:** Either an in-process `asyncio.Lock` keyed by `plan_id` (simplest, sufficient for a single-process deployment), or a DB-level advisory lock / `SELECT ... FOR UPDATE` on the action row before transitioning it to `"executing"`.
**Risk of fixing:** Low.

### H3 — Unbounded disk growth; no data lifecycle management
**Severity:** High
**Why it's a problem:** Every repository ingestion (`.data/repos/<uuid>`) and every plan (`.data/plans/<uuid>`) creates a full git clone that is **never deleted**, by any code path, ever. There is also no `DELETE` endpoint anywhere in the API for repositories, plans, or actions — once created, nothing can be removed except by hand-editing the database and filesystem. In a real deployment with regular usage this is unbounded growth with no operator-facing way to reclaim space short of manual intervention.
**Root cause:** No cleanup job, no TTL, no delete endpoints were ever built — this wasn't in scope for any phase, but it's a real gap for "production readiness."
**Files/modules:** `services/core/app/executor.py` (`_ensure_working_dir` creates, never removes), `services/core/app/ingestion/pipeline.py` (same), absence of any `DELETE` route in `services/core/app/api/*.py`.
**How to reproduce:** [Empirically verified] `.data/plans/` accumulated 20+ full repository clones (~15MB+) over the course of this session alone, purely from normal testing — `ls services/core/.data/plans | wc -l` and `du -sh services/core/.data/plans` confirm this directly.
**Recommended fix:** At minimum, add `DELETE /repos/{id}` (cascades to files/chunks/plans/actions per existing FK `ON DELETE` behavior — verify this is actually configured) and clean up the corresponding clone directory. Consider a periodic cleanup job for `.data/plans/<id>` directories once a plan reaches a terminal state (`completed`/`failed`) and some retention window has passed, since those clones have no ongoing purpose once execution finishes (the diff/rollback data lives in `action_metadata`, not the clone).
**Risk of fixing:** Low for the delete endpoints. Medium for automated cleanup — needs to not delete a plan's clone while a concurrent operation might still need it (ties into H2's locking gap).

### H4 — `clone_url` accepts `file://` scheme (local file disclosure)
**Severity:** High
**Why it's a problem:** With no scheme validation (same root cause as C5), a `clone_url` of `file:///some/path` is accepted by `git clone` and would ingest an arbitrary local filesystem path on the server as a "repository" — after which its contents become chunked, embedded, and queryable through the chat feature. Combined with C1 (no auth), this is a path to reading arbitrary files the `core` process/container can see.
**Root cause:** Same as C5 — no URL scheme allowlist.
**Files/modules:** Same as C5.
**How to reproduce:** Not separately reproduced (would require ingesting a real local path, which felt like an unnecessary escalation given C5 already proves the lack of validation conclusively) — direct consequence of the same missing check.
**Recommended fix:** Covered by C5's fix (scheme allowlist restricted to `https://` GitHub URLs).
**Risk of fixing:** None beyond C5's.

### H5 — Duplicate ingestion has no guard
**Severity:** High
**Why it's a problem:** `POST /repos` with a `clone_url` that's already been ingested creates a **second, entirely independent** `Repository` row — re-cloning, re-chunking, and re-embedding the same content (real cost against Voyage/LLM APIs) and showing up as a confusing duplicate entry in the home page repo list, with its own separate (and now split) chat/timeline/task history.
**Root cause:** No uniqueness check or lookup-by-`clone_url` before creating a new `Repository` row.
**Files/modules:** `services/core/app/api/repos.py` (`create_repo`), `services/core/app/ingestion/pipeline.py` (`create_pending_repository`).
**How to reproduce:** [Empirically verified] `Spoon-Knife` was ingested multiple times over the course of this project's earlier phases and both appeared as independent, fully-duplicated entries in the repo list — visible directly in the home-page screenshots taken during Phase 5-8 testing.
**Recommended fix:** Look up by `clone_url` first; if a `Repository` already exists and is `ready`, return it (or offer an explicit re-ingest/refresh action) instead of silently creating a duplicate.
**Risk of fixing:** Low, but changes response semantics (`POST /repos` becomes idempotent-ish) — worth confirming the desired behavior (return existing vs. 409 vs. explicit re-ingest flag) before implementing.

### H6 — Architecture page's `Promise.all` fails the whole page on any single fetch error
**Severity:** High
**Why it's a problem:** The architecture page fetches `getRepo`, `getArchitecture`, `listFiles`, and `getGraph` via `Promise.all`. These are logically independent sections of the page (repo header, generated doc, dependency graph). If just one fails (e.g. the LLM provider is rate-limited so `getArchitecture` 502s, but the other three would have succeeded), the user sees a bare error message and **none** of the successfully-fetched data, rather than a partial page with only the one failed section flagged.
**Root cause:** `Promise.all` semantics — rejects as soon as any input promise rejects, discarding the results of ones that already resolved.
**Files/modules:** `apps/web/src/app/repos/[id]/architecture/page.tsx` (`Promise.all([getRepo(id), getArchitecture(id), listFiles(id), getGraph(id)])`).
**How to reproduce:** Not separately reproduced (would require forcing one specific fetch to fail on demand); direct from reading the fetch logic — `Promise.all` is unambiguous here.
**Recommended fix:** Switch to `Promise.allSettled`, render each section independently based on its own fulfilled/rejected result.
**Risk of fixing:** Low. Purely additive resilience, no behavior change for the all-succeed case.

---

## Medium

### M1 — `packages/shared` is dead scaffolding; the Action Object contract is duplicated three ways with no sync enforcement
**Severity:** Medium
**Why it's a problem:** `packages/shared/action-object.schema.json` was scaffolded specifically to be the single source of truth for the Action Object contract (per its own referencing comment in `app/models/action.py`: *"keep the two in lockstep by hand"*). It's declared as an npm workspace but **nothing imports it** — not `apps/web` (which defines its own independent `Action`/`ActionObject`-shaped TypeScript interfaces in `lib/api.ts`), not `services/core` (which can't import a TS package anyway, and only references the JSON schema in a comment). The contract now exists independently in three places (the unused JSON schema, the Pydantic model, the TS interface) with zero automated enforcement they agree.
**Root cause:** Phase 0 scaffolding intent was never followed through in later phases.
**Files/modules:** `packages/shared/*`, `services/core/app/models/action.py`, `apps/web/src/lib/api.ts`.
**How to reproduce:** [Empirically verified] `grep -rln "@ambit/shared" apps/web/ services/core/` returns nothing; `packages/shared` is never referenced anywhere except that one docstring comment.
**Recommended fix:** Either wire it up for real (generate the TS types from the JSON schema and have `apps/web` import them; consider whether Pydantic can validate against it too) or delete it and drop the "keep in lockstep by hand" comment's false promise of a shared source of truth.
**Risk of fixing:** Low to delete; medium to actually wire up (real cross-language schema generation tooling, non-trivial).

### M2 — Duplicated "load Plan with eager actions" query pattern (3 copies)
**Severity:** Medium
**Why it's a problem:** The exact `select(Plan).where(Plan.id == ...).options(selectinload(Plan.actions))` pattern — including the specific `session.get()`-doesn't-apply-new-eager-load-options gotcha that caused a real bug earlier this project — is copy-pasted in `plans.py` (twice) and `actions.py` (once). If eager-loading needs change in the future (e.g. to also load `Action.approvals` for some new feature), it's easy to update two of the three copies and reintroduce that exact class of bug in the third.
**Files/modules:** `services/core/app/api/plans.py` (`_get_plan_or_404`, `list_plans`), `services/core/app/api/actions.py` (`rollback_action`).
**Recommended fix:** Extract a shared `get_plan_with_actions(session, plan_id)` helper (e.g. in a small `app/db/queries.py`) and use it in all three places.
**Risk of fixing:** Very low, mechanical refactor.

### M3 — `actions.py` inlines "get action or 404" three times instead of one helper
**Severity:** Medium
**Why it's a problem:** Minor duplication of the same 3-line pattern across `get_action`, `get_action_events`, and `rollback_action` within a single file — no correctness bug today, but unnecessary drift risk.
**Files/modules:** `services/core/app/api/actions.py`.
**Recommended fix:** Extract a local `_get_action_or_404` helper, matching the pattern already used in `repos.py`/`plans.py`.
**Risk of fixing:** Very low.

### M4 — No output-size cap on sandboxed command execution
**Severity:** Medium
**Why it's a problem:** `runner.py`'s `subprocess.run(..., capture_output=True)` buffers stdout/stderr entirely in memory with no size limit. A runaway or malicious `shell_exec` command producing gigabytes of output (accidentally, e.g. an infinite `pip install -v` log, or deliberately) could exhaust memory on the sandbox container (or, per H1, potentially affect `core` too depending on how output flows back).
**Files/modules:** `infra/sandbox/runner.py` (`_run_with_workspace`, `_run_isolated`).
**Recommended fix:** Cap captured output (e.g. via a bounded read loop or `ulimit`/ `--memory` already applied to the *container* but not to the output-capture step in the host-side `runner.py` process itself) and truncate with a clear marker if exceeded.
**Risk of fixing:** Low, but changes what very verbose (legitimate) command output looks like — should truncate generously, not aggressively.

### M5 — Hardcoded weak default database credentials
**Severity:** Medium
**Why it's a problem:** `docker-compose.yml` sets `POSTGRES_PASSWORD: ambit` (matching the username) with no override guidance beyond local dev. Combined with C1 (no API auth), if this compose file were deployed as-is anywhere network-reachable, the database itself would also be trivially guessable.
**Files/modules:** `docker-compose.yml`.
**Recommended fix:** At minimum, document in the README that this must be changed for any non-local deployment; ideally source it from an env var with no hardcoded default.
**Risk of fixing:** Low.

### M6 — No accessibility attributes anywhere in the frontend
**Severity:** Medium
**Why it's a problem:** Zero `aria-*` attributes or explicit ARIA roles exist across every page. All three primary text inputs (repo URL, chat question, task description) rely solely on `placeholder` text with no associated `<label>`, which most accessibility guidelines (WCAG 1.3.1/4.1.2) call out as insufficient — placeholder text disappears once the user types and isn't a reliable accessible name across all assistive tech.
**Files/modules:** All of `apps/web/src/app/**/*.tsx`.
**How to reproduce:** [Empirically verified] `grep -rln "aria-\|role="` across the whole `src/` tree returns zero matches.
**Recommended fix:** Add visually-hidden `<label>` elements (or `aria-label`) to the three inputs at minimum; add `aria-live="polite"` regions around async status updates (chat responses, plan status changes) for screen-reader users.
**Risk of fixing:** Very low, purely additive.

### M7 — Essentially no responsive layout
**Severity:** Medium
**Why it's a problem:** Only one Tailwind responsive breakpoint (`sm:`) exists in the entire frontend (on the analytics page's stat-card grid). Every other page uses fixed-width containers and, in the Tasks page's case, a fixed `w-56` sidebar next to a flex-1 main area — this will likely overflow or become unusable on narrow/mobile viewports.
**Files/modules:** All of `apps/web/src/app/**/*.tsx`.
**How to reproduce:** [Empirically verified] `grep -rc "sm:\|md:\|lg:"` across all page files returns 0 or 1 for every file.
**Recommended fix:** Not urgent for a developer tool likely used on desktop, but worth a pass on the Tasks/Timeline pages' fixed-width layouts if mobile/tablet use is ever expected.
**Risk of fixing:** Low.

### M8 — Already-documented limitations, restated here for backlog completeness
**Severity:** Medium (context-dependent — these are known, not newly discovered)
**Why it's a problem:** For completeness as a v1.0 backlog, cross-referencing what the README already discloses: (a) full-file regeneration for `file_write` can incidentally alter unrelated formatting; (b) the planner's grounding of exact subdirectory paths/commands isn't 100% reliable even with prompting; (c) the sandbox's default image (`alpine:3.20`) has no language runtime for ad-hoc `shell_exec` commands outside the test-run path; (d) only the Web UI adapter exists, not the Claude Code/CLI wrapper adapters from the original plan.
**Recommended fix:** No new action needed beyond what's already tracked; listed here so this document is a complete picture in one place.
**Risk of fixing:** N/A.

---

## Low

### L1 — Inconsistent "loading" text color across pages
**Severity:** Low
**Why it's a problem:** Purely cosmetic — some pages use `text-neutral-400` for loading states, others `text-neutral-500`, for the same semantic state.
**Files/modules:** Various `page.tsx` files under `apps/web/src/app/`.
**Recommended fix:** Standardize on one shade, ideally by extracting a shared `<Loading />` text component alongside the existing `badges.tsx`/`RepoNav.tsx` pattern.
**Risk of fixing:** None.

### L2 — RepoNav active-tab styling showed a stale-hover artifact during automated testing
**Severity:** Low
**Why it's a problem:** During GIF-recording/automated click-through, a screenshot showed the "Tasks" tab underlined (hover style) immediately after navigating to the Architecture page — the URL and rendered content were both correct, so this is very likely a stale cursor-position artifact from automated clicking (the mouse didn't move away after the click, and CSS `:hover` picked up its position against the new page's layout), not a real navigation bug. Flagging for a quick manual mouse-driven check to be certain, since it wasn't conclusively resolved.
**Files/modules:** `apps/web/src/components/RepoNav.tsx`.
**Recommended fix:** Manually click through the nav (not via automation) to confirm the active-tab indicator is correct; no code change identified as needed based on current evidence.
**Risk of fixing:** N/A pending confirmation.

### L3 — PR body's own `git_push` row always shows "executing," never "completed"
**Severity:** Low
**Why it's a problem:** `pr_description.py` builds the PR body *during* the `git_push` step's own execution, so that step's row in the generated steps table can never reflect its own final "completed" status by the time the PR is opened. Inherent to the design (the PR doesn't exist until after the push succeeds), not fixable without restructuring, and cosmetic only.
**Files/modules:** `services/core/app/pr_description.py`, `services/core/app/executor.py` (git_push branch).
**Recommended fix:** Could special-case the currently-executing `git_push` row to display as "completing" or omit its own status, but genuinely low value given it's self-evidently the step that's currently running.
**Risk of fixing:** Low, cosmetic only.

### L4 — Orphaned OAuth stub (`app/api/github.py`) is dead-ish code
**Severity:** Low
**Why it's a problem:** `/auth/github/login` and `/auth/github/callback` implement a real GitHub OAuth token exchange but explicitly don't persist the result anywhere (per its own comment: *"Phase 0 stub... persisting the token against a user/session record is deferred"*) — it's routed and technically callable but not wired into anything else in the system. Not harmful, but it's vestigial and could confuse a future reader into thinking auth exists (ties thematically to C1).
**Files/modules:** `services/core/app/api/github.py`.
**Recommended fix:** Either finish wiring it up as part of fixing C1, or remove it until it's actually used.
**Risk of fixing:** None either way (it's currently inert).

---

## Suggested triage order for v1.0

1. **C1 (auth)** and **C4 (policy default-allow + missing file_write/file_delete rules)** together — these two are the actual governance-bypass core of the product's value prop and should ship together, since fixing one without the other still leaves a hole.
2. **C3 (approval race)** — small, contained, high-value fix.
3. **C2 (path traversal)** and **C5 (git argument injection)** — both are small, additive input-validation fixes with essentially no risk of breaking existing behavior.
4. **H1 (blocking event loop)** — larger mechanical effort but directly determines whether this can serve more than one user at a time.
5. **H2 (execution locking)**, **H3 (disk growth / no delete endpoints)**, **H5 (duplicate ingestion)** — operational correctness, not urgent for a single-user demo but real gaps for anything beyond that.
6. Everything else opportunistically.
