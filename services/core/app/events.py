"""In-process pub/sub for live plan progress (Orion Phase 2: live runtime).

Deliberately not Postgres LISTEN/NOTIFY or any external broker -- this
service runs as a single uvicorn worker (see Dockerfile's explicit
--workers 1, which is load-bearing for this module, not incidental), so
a plain in-process dict of subscriber queues is correct and needs no new
infrastructure. If this service is ever split across multiple worker
processes, this module stops being sufficient and needs to move to a
real broker -- it will not fail silently in an obvious way, so revisit
this file first if live events ever seem to "not arrive" after a deploy
topology change.

Keyed by plan_id specifically, not action_id or globally: every current
live-streaming consumer (CLI, eventually a browser "active runs" view)
watches one plan at a time, and Event rows don't always have a plan_id
(raw POST /actions submissions from non-planner adapters don't) -- those
simply aren't published anywhere, which is fine, nothing subscribes to
them today.
"""

import asyncio
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, TYPE_CHECKING

if TYPE_CHECKING:
    from app.db.models import Action, Event


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, set[asyncio.Queue]] = defaultdict(set)

    @asynccontextmanager
    async def subscribe(self, plan_id: uuid.UUID) -> AsyncIterator[asyncio.Queue]:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[plan_id].add(queue)
        try:
            yield queue
        finally:
            # Runs on normal completion AND on the consumer disconnecting
            # (StreamingResponse cancels the generator, which raises here) --
            # this is what makes a killed CLI process not leak a subscriber.
            self._subscribers[plan_id].discard(queue)
            if not self._subscribers[plan_id]:
                del self._subscribers[plan_id]

    def publish(self, plan_id: uuid.UUID, message: dict[str, Any]) -> None:
        for queue in self._subscribers.get(plan_id, ()):
            queue.put_nowait(message)

    def subscriber_count(self, plan_id: uuid.UUID) -> int:
        return len(self._subscribers.get(plan_id, ()))


event_bus = EventBus()


def action_envelope(action: "Action") -> dict[str, Any]:
    """The minimal per-action context every stream message carries
    alongside the raw Event, so a consumer (the CLI) can render
    "[2/7] Updating middleware" without a second lookup per event. Reused
    by every publish call site (planner.py, executor.py, approvals.py)
    so the shape can't drift between them."""
    return {
        "id": str(action.id),
        "action_type": action.action_type,
        "target": action.target,
        "risk_level": action.risk_level,
        "status": action.status,
    }


def event_message(action: "Action", event: "Event") -> dict[str, Any]:
    """The full stream message envelope for one real, persisted Event --
    the counterpart to the synthesized plan_snapshot/stream_end framing
    messages the stream endpoint sends itself (see api/plans.py)."""
    return {
        "type": "action_event",
        "action": action_envelope(action),
        "event": {
            "id": str(event.id),
            "event_type": event.event_type,
            "payload": event.payload,
            "created_at": event.created_at.isoformat(),
        },
    }
