import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from app.config import settings

router = APIRouter(prefix="/auth/github", tags=["github"])

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"


@router.get("/login")
async def login():
    if not settings.github_client_id:
        raise HTTPException(
            status_code=503,
            detail="GITHUB_CLIENT_ID is not configured. Create a GitHub OAuth app and set "
            "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET in services/core/.env before using this route.",
        )
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_oauth_redirect_url,
        "scope": "repo read:user",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(f"{AUTHORIZE_URL}?{query}")


@router.get("/callback")
async def callback(code: str):
    if not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(
            status_code=503,
            detail="GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not configured.",
        )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_oauth_redirect_url,
            },
        )
        resp.raise_for_status()
        token_data = resp.json()

    if "error" in token_data:
        raise HTTPException(status_code=400, detail=token_data)

    # Phase 0 stub: token exchange works, but persisting the token against a
    # user/session record is deferred to Phase 1 (needs the DB schema + auth model).
    return {"access_token_received": True, "scope": token_data.get("scope")}
