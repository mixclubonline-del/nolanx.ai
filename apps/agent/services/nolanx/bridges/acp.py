"""ACP bridge catalog for OpenClaw/Hermes style remote runtimes."""

from __future__ import annotations

import aiohttp

from services.runtime_logger import log_runtime_event
from typing import Any

from services.config_service import config_service


BUILTIN_ACP_BRIDGES = [
    {
        "name": "openclaw_migration_bridge",
        "protocol": "acp",
        "runtime": "openclaw",
        "description": "Bridge metadata for importing OpenClaw-style ACP agent workflows into NolanX.",
    },
    {
        "name": "hermes_remote_runtime",
        "protocol": "acp",
        "runtime": "hermes",
        "description": "Bridge metadata for delegating compatible sessions into Hermes-style remote runtimes.",
    },
]


def get_acp_bridge_catalog() -> list[dict[str, Any]]:
    cfg = config_service.get_service_config("nolanx") or {}
    configured = [item for item in (cfg.get("acp_bridges", []) or []) if isinstance(item, dict)]
    return BUILTIN_ACP_BRIDGES + configured


def _resolve_bridge(bridge_name: str) -> dict[str, Any]:
    normalized = str(bridge_name or "").strip().lower()
    for bridge in get_acp_bridge_catalog():
        if str(bridge.get("name") or "").strip().lower() == normalized:
            return bridge
    raise ValueError(f"ACP bridge '{bridge_name}' was not found")


async def invoke_acp_bridge(
    bridge_name: str,
    operation: str,
    payload: dict[str, Any] | None = None,
    *,
    session_id: str | None = None,
    canvas_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    bridge = _resolve_bridge(bridge_name)
    endpoint = str(
        bridge.get("invoke_url")
        or bridge.get("gateway_url")
        or bridge.get("endpoint")
        or ""
    ).strip()
    if not endpoint:
        raise ValueError(f"ACP bridge '{bridge_name}' is cataloged but has no executable endpoint configured")

    invoke_url = endpoint if endpoint.endswith("/invoke") else endpoint.rstrip("/") + "/invoke"
    body = {
        "operation": str(operation or "").strip(),
        "payload": payload or {},
        "state": build_acp_bridge_state(session_id=session_id, canvas_id=canvas_id, user_id=user_id),
        "bridge": bridge,
    }
    timeout_seconds = int(bridge.get("timeout_seconds") or 120)

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout_seconds)) as session:
        async with session.post(invoke_url, json=body) as response:
            response_text = await response.text()
            if response.status >= 400:
                raise ValueError(f"ACP bridge invoke failed: HTTP {response.status}: {response_text}")
            try:
                data = await response.json()
            except Exception:
                data = {"raw": response_text}

    log_runtime_event(
        "acp.bridge.invoked",
        bridge_name=bridge_name,
        operation=operation,
        session_id=session_id,
        canvas_id=canvas_id,
        user_id=user_id,
        invoke_url=invoke_url,
    )
    return {
        "bridge": bridge_name,
        "operation": operation,
        "invoke_url": invoke_url,
        "result": data,
    }


def build_acp_bridge_state(session_id: str | None, canvas_id: str | None, user_id: str | None) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "canvas_id": canvas_id,
        "user_id": user_id,
        "bridges": get_acp_bridge_catalog(),
    }
