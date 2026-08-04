# Ambit — Project Plan & Feasibility Review

*A runtime/control-plane for AI coding agents*

---

## 1. Reality check first

The pitch describes something roughly equivalent to GitHub + Datadog + HashiCorp Vault + an IAM system + an APM tool + a policy engine, purpose-built for AI coding agents. That is a multi-year, multi-team enterprise product. It is a genuinely strong *portfolio direction* — consolidating RepoMind/AgentAudit/VaultKey/ClaimGuard into one coherent "trust layer" is a real improvement over four disconnected apps — but the goal now is explicitly to end up with a **real, running piece of infrastructure**, not a demo that gets abandoned after the pitch. Section 2 is about making sure the architecture supports that from day one.

Timeline-wise: even the trimmed MVP is realistically **8–12 weeks part-time** for one person. Treat any "weeks" estimate as "get an end-to-end vertical slice working," not "feature-complete."

---

## 2. Architecture decision: runtime-first, not demo-first

You raised the right doubt: *where does the actual code-editing happen — on your servers, inside Cursor, or somewhere in between?* This decision determines whether Ambit is a real product or a wrapper around someone else's agent. Here's the resolved architecture.

### The four options, briefly
- **Option 1 — Everything on your servers (Devin-style).** Your backend calls an LLM directly and edits files itself. Easy to demo, but you're now competing with Devin/Cursor at the coding-agent layer, paying for every LLM call, and asking users to upload code to a third party. This is the weakest long-term position — you'd be reimplementing an agent, not governing one.
- **Option 2 — Cursor extension.** Confirmed by current docs: Cursor supports MCP tools, but there's no public mechanism to intercept or block Cursor's *own* built-in file-edit/terminal actions. A Cursor integration can only govern actions that go through *your* MCP tools — it cannot guarantee it sees everything Cursor does. Don't build this first, and don't claim full governance over Cursor in the pitch.
- **Option 3 — MCP server.** Agents call your MCP server instead of touching files/git/terminal directly. Real and buildable. MCP is now Linux-Foundation-governed and supported by Claude Code, OpenHands, Gemini CLI, and (as a client) Cursor. The catch: an agent only routes through your MCP tools if it *chooses to* — nothing stops it from using its own native tools instead, unless the host application specifically restricts it to your tools.
- **Option 4 — Claude Code hooks (the missing piece from the original analysis).** Claude Code has a hooks system (`PreToolUse`, `PostToolUse`, etc.) that fires on *every* tool call Claude Code makes — including its built-in Read/Write/Edit/Bash tools, not just custom MCP tools. A hook can inspect, block, or rewrite the action before it executes. This is a **harder guarantee than MCP** for Claude Code specifically: you're not hoping the agent chooses your tool, you're sitting in front of all its tools by construction.

### Decision
Build Ambit as a **standalone runtime/policy engine with a stable internal API**, and put three thin adapters in front of it, all calling the same core:

1. **Web UI + API** — lets you demo end-to-end today without depending on any third-party agent's cooperation. This is also just a real product surface (dashboard, approvals, audit timeline), not a throwaway demo shell.
2. **Claude Code integration** — hooks (hard interception, all tool calls) + an MCP server (exposes Ambit's own tools: risk score, request approval, query the knowledge graph). This is your strongest, most defensible integration and should be the flagship one.
3. **Generic CLI wrapper** (`ambit run <agent-command>`) — runs any agent (Claude Code, Aider, a custom script) inside a sandboxed process where filesystem/git writes are mediated by Ambit rather than going straight to disk. This is your fallback for agents that support neither hooks nor MCP, and it doesn't depend on any vendor shipping an API for you — you control the sandbox boundary yourself. Same idea as `docker compose` wrapping `docker`.

Cursor gets an MCP-only integration, explicitly framed as partial governance ("actions routed through Ambit's MCP tools are governed; Cursor's fully native edits are visible in logs after the fact via file-watching, not blocked beforehand"). Don't oversell this one.

This is also the answer to "will this remain a demo forever": the web UI is not a separate thing you build first and retrofit — it's client #1 of a runtime that's designed for multiple clients from the start. The pitch line becomes:

> "Ambit is a policy/audit runtime for AI coding agents. Today it ships a web UI, a Claude Code integration (hooks + MCP), and a CLI wrapper for any other agent. The same governance core — risk scoring, policy checks, approval, audit, rollback — runs underneath all three, so adding the next agent (OpenHands, Gemini CLI, Codex CLI) is a new adapter, not a rewrite."

That's the "Nginx/Kubernetes for AI agents" framing from the original analysis, minus the parts that overclaim what's possible with vendors who don't expose deep hooks.

### Second-order benefit
This also answers "what happens when GPT-6 makes Claude obsolete" — your value is the policy/risk/audit/rollback core, which is model-agnostic by construction, not the specific LLM calls.

---

## 3. What won't work as pitched / what to cut or reframe

**Rollback is not universally possible.** File edits and git commits are reversible. Database schema migrations are *sometimes* reversible (a generated down-migration can't restore dropped column data). Anything with an external side effect — a sent webhook, a Stripe charge, an email, a third-party API call — **cannot be undone by your platform, full stop**. Reframe "Rollback Engine" as scoped to file/git/DB-state changes, and have the risk engine treat irreversible action types as automatically high-risk/approval-required rather than promising to undo them.

**"Understands" is a probabilistic LLM summary, not ground truth.** Ship a confidence indicator and a "source: inferred from code + commit history" tag on every generated explanation. Same caveat applies to Repository Chat — quality depends entirely on the repo's commit/PR hygiene.

**Sandboxing agent-issued shell/Docker commands is the hardest part of this project, not an afterthought**, and it's now also the mechanism the CLI wrapper depends on — so it's load-bearing for two parts of the architecture, not one. Docker-in-Docker at minimum for MVP; gVisor/Firecracker for anything resembling production-grade. Build this in Phase 0.

**Screen recording (Audit Engine) is likely not worth building.** Expensive, mostly redundant with structured action logs, privacy questions for no clear benefit. Cut it.

**"Store every event forever" needs a retention policy**, or your database bill becomes the story instead of the product.

**Multi-agent orchestration (7+ specialist agents) is expensive and hard to get reliable.** Build it last, after the single-agent pipeline is solid.

**Don't build your own secrets vault or policy engine from scratch.** Wrap Vault/Infisical and OPA/Cedar respectively — smaller build, more credible to reviewers who know the space.

**Auto-generated architecture/sequence/ER diagrams** are good for structural facts, unreliable for anything requiring judgment. Ship as "generated, verify before publishing."

**Test Intelligence's full list is not realistically automatable across arbitrary languages in this timeframe.** Scope to unit + integration test generation for one or two languages for MVP.

**Data handling / consent.** Don't index other people's private repos for demo purposes without explicit permission.

---

## 4. Recommended MVP tech stack

| Layer | MVP choice | Defer to "roadmap" |
|---|---|---|
| Frontend | Next.js + Tailwind + React Flow + Monaco | — |
| Backend (runtime core) | FastAPI, single service with a clean internal API used by all three adapters | Go execution runtime for low-latency policy checks |
| Agent adapters | Claude Code hooks bundle + MCP server; generic CLI wrapper (`ambit run`) | Cursor MCP-only integration; OpenHands runtime fork |
| Data | Postgres + pgvector | Neo4j (use NetworkX/recursive CTEs at demo scale), ClickHouse (Postgres partitioned tables until real volume) |
| AI | One primary provider (Claude, via Agent SDK) | OpenAI/Gemini/Ollama as pluggable providers |
| Orchestration | Hand-rolled DAG executor | LangGraph |
| Sandboxing | Docker-in-Docker, non-negotiable from day one — also underlies the CLI wrapper | Firecracker/gVisor |
| Policy | Wrap OPA (Rego) | Bespoke policy DSL |
| Secrets | Wrap Vault or Infisical | Build-your-own vault |

---

## 5. Phased task breakdown

### Phase 0 — Setup + sandbox (few days)
- [ ] Repo scaffolding: monorepo layout, Next.js app, FastAPI service, shared types
- [ ] Docker-in-Docker sandbox execution environment — build this first, it underlies both agent execution *and* the CLI wrapper
- [ ] GitHub OAuth app + GitHub API client (repo listing, clone, webhook subscription)
- [ ] Postgres + pgvector provisioned (local Docker Compose for dev)

### Phase 1 — Runtime core (the actual product)
- [ ] Define the Action Object schema (action type, target, actor/agent, metadata) — this is the shared contract every adapter speaks
- [ ] Rule-based risk scorer (file path, action type, branch, environment → score)
- [ ] Wrap OPA for policy rules ("no direct commits to main," "no prod DB access," etc.)
- [ ] Approval flow (pending/approved/denied state machine) with a human-approval endpoint
- [ ] Structured event log (Postgres) — every Action Object, decision, and outcome
- [ ] Internal API that Phase 5's three adapters all call into — build this before any adapter, not after

### Phase 2 — Repository Intelligence
- [ ] Clone/ingest a repo; walk directory structure, detect languages/frameworks
- [ ] Tree-sitter parsing → extract functions, classes, imports, API routes
- [ ] Lightweight dependency graph (in-memory/NetworkX, edges stored in Postgres)
- [ ] Chunk + embed code and docs into pgvector for retrieval
- [ ] LLM-generated semantic summaries per file/module, tagged "inferred" with a confidence score
- [ ] Basic code-ownership detection from `git blame`/commit history

### Phase 3 — Repository Chat
- [ ] RAG pipeline over embedded code + git log + PR/issue text
- [ ] Chat UI with source citations
- [ ] Explicit "not enough history to answer confidently" fallback

### Phase 4 — Architecture Generation
- [ ] Auto-generate a dependency/service graph diagram (React Flow) from Phase 2 data
- [ ] Auto-generate a Markdown README/architecture doc
- [ ] One well-understood sequence diagram (e.g. an API request path)
- [ ] Mark all generated docs "AI-generated, verify before use"

### Phase 5 — Agent adapters (three thin clients over the Phase 1 core)
- [ ] **Web UI adapter:** task input → LLM decomposes into a DAG of Action Objects → each one flows through the Phase 1 pipeline → execute in sandbox → PR
- [ ] **Claude Code adapter:** hooks bundle that routes every `PreToolUse` event through Phase 1's API before allowing execution; MCP server exposing Ambit's risk/policy/query tools
- [ ] **CLI wrapper adapter (`ambit run <cmd>`):** launches the wrapped agent inside the Phase 0 sandbox with mediated filesystem/git access, routing writes through Phase 1
- [ ] DAG visualization UI (shared across adapters, since they all produce Action Objects)

### Phase 6 — Audit + Rollback
- [ ] Timeline UI: chronological view of actions, risk flags, approvals, across all three adapters
- [ ] Diff view per action
- [ ] File/git-level rollback (revert commit, restore deleted file); DB/external-side-effect rollback stays a "generate a proposed reverse migration for human review," not automatic

### Phase 7 — Test generation + PR creation
- [ ] Generate unit/integration tests for changed code (1–2 languages first)
- [ ] Run tests in sandbox; block PR creation on failure
- [ ] Auto-generate PR description summarizing plan, risk score, and approval trail

### Phase 8 — Polish for demo
- [ ] End-to-end scripted demo across all three adapters (same repo, same task, via web UI, via Claude Code, via CLI wrapper) — this is the single most convincing thing you can show, since it proves the "runtime, not a demo" claim
- [ ] Developer analytics dashboard: acceptance rate, rollback frequency, risk distribution
- [ ] Recorded walkthrough for the portfolio page

### Explicitly deferred (roadmap, don't attempt for v1)
- Deep Cursor interception (not possible with current public APIs — MCP-only integration is the ceiling today)
- OpenHands runtime fork, Gemini CLI / Codex CLI adapters
- Multi-agent orchestration with distinct specialist roles
- Mutation/performance/security test automation
- Confluence/Wiki export
- Full secrets-vault build (use Vault/Infisical integration instead)
- Kubernetes/cloud-command execution
- Neo4j/ClickHouse/Go runtime (documented, not built)

---

## 6. Naming: Ambit

Decided — checked earlier against obvious collisions (no direct hits in the AI-agent-governance space, unlike WatchTower/Sentinel/Warden/Custos, which are all crowded right now). Still worth a proper USPTO trademark search, domain check, and GitHub org/npm/PyPI availability check before you lock it in anywhere permanent — the earlier check was a web search, not an exhaustive trademark search.

---

## 7. Bottom line

The fix for "will this stay a demo forever" is architectural, not a matter of trying harder: build the risk/policy/audit/approval core as a standalone service with a real internal API first, then attach the web UI, the Claude Code integration, and the CLI wrapper as three adapters on top of it. That's what makes the difference between "a website that calls an LLM" and "infrastructure that happens to have a website." Be honest in the pitch about where the guarantee is strong (Claude Code, via hooks) versus partial (Cursor, via MCP only, no native-action interception yet) versus self-controlled (CLI wrapper, works for anything you can put in a sandbox).
