from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.actions import router as actions_router
from app.api.approvals import router as approvals_router
from app.api.github import router as github_router
from app.api.health import router as health_router
from app.api.repos import router as repos_router

app = FastAPI(title="Ambit Runtime Core")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(github_router)
app.include_router(actions_router)
app.include_router(approvals_router)
app.include_router(repos_router)
