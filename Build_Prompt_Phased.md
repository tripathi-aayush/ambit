# Phased Build Prompt (paste into Claude Code)

Copy `Project_Plan_and_Feasibility_Review.md` into your repo root as `PROJECT_PLAN.md`, then paste this as your opening instruction:

```
You are building Ambit, a runtime/policy engine that governs AI coding agents (Claude Code,
CLI-wrapped agents, and eventually others) instead of letting them touch files/git/terminal
directly. Read PROJECT_PLAN.md in this repo first — it has the full phase breakdown, the
architecture decision (runtime core + three thin adapters: web UI, Claude Code hooks/MCP, CLI
wrapper), the trimmed tech stack, and an explicit list of what's deferred out of scope. Treat
it as the source of truth.

Work in phases, in the order listed in the plan (Phase 0 through Phase 8). Do not start a
phase until the previous one is done and I've reviewed it. Rules:

1. At the start of each phase, restate that phase's task checklist from the plan and confirm
   scope with me before writing any code.
2. Build the runtime core (Phase 1) as a standalone service with a clean internal API before
   building any adapter on top of it. The web UI, the Claude Code integration, and the CLI
   wrapper must all call the same core — do not let any adapter grow its own copy of the
   risk/policy/audit logic.
3. Build only what's listed for that phase. Do not implement anything from the "explicitly
   deferred" list (deep Cursor interception, multi-agent orchestration, Neo4j/ClickHouse/Go
   runtime, custom vault/policy engine, mutation testing, etc.) unless I explicitly ask you to
   pull it forward.
4. Use the trimmed tech stack from the plan (Next.js/Tailwind/React Flow/Monaco frontend,
   FastAPI backend, Postgres+pgvector, Docker-in-Docker sandbox from day one, OPA for policy,
   Vault/Infisical for secrets). Don't introduce new infra without asking first.
5. Tag any LLM-generated output (summaries, architecture docs, chat answers) as AI-generated /
   inferred — never present it as verified fact.
6. Sandboxing for agent-executed shell/Docker commands is mandatory starting Phase 0, since both
   the CLI wrapper and Claude Code adapter depend on it. Never run agent-issued commands
   directly on the host.
7. Commit as you go, one logical unit of work per commit, with clear messages.
8. At the end of each phase: run whatever tests/build steps exist, tell me what was actually
   completed vs. stubbed/mocked, flag any risks or shortcuts, and stop — wait for my go-ahead
   before starting the next phase.
9. If something turns out harder or riskier than the plan assumed once you're in the code, say
   so and propose a scoped-down alternative instead of silently cutting corners. In particular,
   flag early if Claude Code's hooks API doesn't behave the way Phase 5 assumes — that adapter
   is the flagship integration, so get a spike working before committing to the full build.

Start with Phase 0 now: restate its checklist and begin.
```
