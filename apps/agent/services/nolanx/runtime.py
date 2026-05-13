"""NolanX runtime components: orchestration memory, store, and context helpers."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from services.config_service import config_service

from .bridges import get_acp_bridge_catalog
from .memory import get_memory_provider_catalog
from .persistence import PersistentCheckpointSaver, PersistentStore
from .providers import get_provider_router_snapshot


def _get_nolanx_config() -> dict[str, Any]:
    return config_service.get_service_config("nolanx") or {}


def _runtime_root() -> Path:
    cfg = _get_nolanx_config()
    configured = str(cfg.get("runtime_root") or os.getenv("NOLANX_RUNTIME_ROOT") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[3] / "user_data" / "nolanx-runtime"


@lru_cache(maxsize=1)
def get_checkpointer() -> PersistentCheckpointSaver:
    return PersistentCheckpointSaver(_runtime_root() / "checkpoints.pkl")


@lru_cache(maxsize=1)
def get_store() -> PersistentStore:
    return PersistentStore(_runtime_root() / "store.pkl")


def get_runtime_components() -> dict[str, Any]:
    return {
        "checkpointer": get_checkpointer(),
        "store": get_store(),
        "config": _get_nolanx_config(),
    }


def get_runtime_profile() -> dict[str, Any]:
    cfg = _get_nolanx_config()
    return {
        "orchestrator": cfg.get("orchestrator", "nolanx"),
        "checkpoint_backend": cfg.get("checkpoint_backend", "nolanx-file"),
        "store_backend": cfg.get("store_backend", "nolanx-file"),
        "runtime_root": str(_runtime_root()),
        "provider_router": cfg.get("provider_router", "nolanx"),
        "skills_enabled": bool(cfg.get("skills_enabled", True)),
        "mcp_enabled": bool(cfg.get("mcp_enabled", True)),
        "memory_enabled": bool(cfg.get("memory_enabled", True)),
        "provider_router_snapshot": get_provider_router_snapshot(),
        "memory_providers": get_memory_provider_catalog(),
        "acp_bridges": get_acp_bridge_catalog(),
    }
