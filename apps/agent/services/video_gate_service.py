from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass
class VideoGateSession:
    event: asyncio.Event
    approved: bool = False
    reason: str = ""
    payload: dict[str, Any] | None = None


_video_gate_sessions: dict[str, VideoGateSession] = {}


def prepare_video_gate(session_id: str, payload: dict[str, Any] | None = None) -> None:
    _video_gate_sessions[session_id] = VideoGateSession(
        event=asyncio.Event(),
        approved=False,
        reason="",
        payload=payload or {},
    )


def approve_video_gate(session_id: str, reason: str = "generate_now") -> bool:
    gate = _video_gate_sessions.get(session_id)
    if gate is None:
        return False
    gate.approved = True
    gate.reason = reason
    gate.event.set()
    return True


async def wait_for_video_gate(session_id: str, timeout_seconds: int) -> str:
    gate = _video_gate_sessions.get(session_id)
    if gate is None:
        return "missing"

    try:
        await asyncio.wait_for(gate.event.wait(), timeout=max(1, timeout_seconds))
        return "approved" if gate.approved else "released"
    except asyncio.TimeoutError:
        return "timed_out"


def clear_video_gate(session_id: str) -> None:
    _video_gate_sessions.pop(session_id, None)
