import asyncio
import time
from typing import Any, Dict, Optional
from app.core.database import db
from app.core.logging import get_logger
from app.graph.state import ReviewState

logger = get_logger(__name__)

# Lock to ensure sequential sequence_id assignment per review
_seq_locks: Dict[str, asyncio.Lock] = {}
_seq_counters: Dict[str, int] = {}


def _get_lock(review_id: str) -> asyncio.Lock:
    if review_id not in _seq_locks:
        _seq_locks[review_id] = asyncio.Lock()
    return _seq_locks[review_id]


async def emit_event(
    state: ReviewState,
    event_type: str,
    data: Dict[str, Any],
    agent: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Centralized event dispatcher ensuring globally monotonic sequence IDs,
    database persistence for SSE replay, and stream callback notification.
    """
    review_id = state.get("review_id", "default")
    lock = _get_lock(review_id)

    async with lock:
        current_seq = _seq_counters.get(review_id, 0) + 1
        _seq_counters[review_id] = current_seq

        event_payload = {
            "review_id": review_id,
            "event_type": event_type,
            "agent": agent,
            "data": data,
            "sequence_id": current_seq,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        # Keep in state
        events = state.setdefault("events", [])
        events.append(event_payload)

        # Persist event in DB for replay
        if review_id and review_id != "default":
            await db.save_event(review_id, event_type, data, current_seq, agent=agent)

        # Deliver to live streaming SSE queue if emitter callback is registered
        emitter = state.get("event_emitter")
        if emitter and callable(emitter):
            try:
                await emitter(event_payload)
            except Exception as exc:
                logger.debug(f"Event emitter callback exception: {exc}")

        return event_payload


def reset_sequence(review_id: str):
    """Resets the sequence counter for a review ID."""
    if review_id in _seq_counters:
        del _seq_counters[review_id]
