"""Sprint 1 / audit finding C1: shared-secret API key auth.

Deliberately simple -- one shared secret via the X-Orion-Key header, no
per-user identity, sessions, or roles. Real auth (GitHub OAuth, per-user
tokens) is future work; this closes the "anyone who can reach the port
can approve/deny/execute anything" gap for now. See AUDIT_REPORT.md C1.

Registered as a global FastAPI dependency (see app/main.py) so every
route is covered by construction -- a new router can't accidentally
forget to require it.
"""

import hmac

from fastapi import Header, HTTPException

from app.config import settings

API_KEY_HEADER = "X-Orion-Key"


async def require_api_key(x_orion_key: str | None = Header(default=None, alias=API_KEY_HEADER)) -> None:
    if not settings.orion_api_key:
        # Unconfigured is a server misconfiguration, not "auth disabled" --
        # fail closed (block everything) rather than silently allowing
        # requests through, which is exactly the fail-open pattern this
        # fix exists to remove.
        raise HTTPException(status_code=500, detail="ORION_API_KEY is not configured on the server")
    if x_orion_key is None:
        raise HTTPException(status_code=401, detail="missing X-Orion-Key header")
    # Constant-time compare -- plain `!=` short-circuits on the first
    # differing character, which leaks key length/prefix via response
    # timing over enough attempts.
    if not hmac.compare_digest(x_orion_key, settings.orion_api_key):
        raise HTTPException(status_code=403, detail="invalid X-Orion-Key")
