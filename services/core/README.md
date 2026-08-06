# Orion — core

FastAPI backend: ingestion, RAG, the risk/policy/approval pipeline, the Web UI adapter's planner + executor. See the [root README](../../README.md) for what Orion is and how to run the full stack.

```bash
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in ORION_API_KEY, LLM_PROVIDER + one API key
./.venv/bin/alembic upgrade head
./.venv/bin/uvicorn app.main:app --reload   # localhost:8000, expects postgres+opa running (docker compose up -d postgres opa)
```

`docker compose up -d sandbox` is also required for anything that runs `shell_exec` (including test-run steps in Phase 5/7 plans).

Every request needs an `X-Orion-Key` header matching `ORION_API_KEY`, or it's rejected (`500` if unset, `401`/`403` if missing/wrong on the request). See the root README's [Authentication](../../README.md#authentication) section for the full setup and failure modes — the frontend's `apps/web/.env.local` needs the same key too.
