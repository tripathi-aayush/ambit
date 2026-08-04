from fastapi import FastAPI

from app.api.github import router as github_router
from app.api.health import router as health_router

app = FastAPI(title="Ambit Runtime Core")

app.include_router(health_router)
app.include_router(github_router)
