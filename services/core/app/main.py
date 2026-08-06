import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.actions import router as actions_router
from app.api.analytics import router as analytics_router
from app.api.approvals import router as approvals_router
from app.api.github import router as github_router
from app.api.health import router as health_router
from app.api.plans import router as plans_router
from app.api.repos import router as repos_router
from app.auth import require_api_key

logger = logging.getLogger("ambit")

# Global dependency: every route on this app requires a valid X-Ambit-Key
# header (see app/auth.py, audit finding C1). Applied at the app level
# rather than per-router so a new router added later is covered by
# construction, not by remembering to wire it in.
app = FastAPI(title="Ambit Runtime Core", dependencies=[Depends(require_api_key)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Defense-in-depth JSON body for anything that isn't caught closer to
    # its source. NOTE: this does NOT fix CORS on error responses — Starlette
    # routes a bare-Exception handler to ServerErrorMiddleware, which wraps
    # CORSMiddleware from the outside, so this response still comes back
    # without CORS headers (browsers report that as an opaque "Failed to
    # fetch"). Endpoints that call external APIs must catch and re-raise as
    # HTTPException themselves — HTTPException is handled by
    # ExceptionMiddleware, which sits inside CORSMiddleware and gets CORS
    # headers applied correctly. See app/api/repos.py's chat endpoint.
    logger.exception("unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.include_router(health_router)
app.include_router(github_router)
app.include_router(actions_router)
app.include_router(approvals_router)
app.include_router(repos_router)
app.include_router(plans_router)
app.include_router(analytics_router)
