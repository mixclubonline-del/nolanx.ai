"""Provider router inspired by Hermes custom provider routing."""

from __future__ import annotations

from typing import Any

from services.config_service import config_service

DEFAULT_TASK_PROVIDER_MAP = {
    "text": ["openrouter", "google_genai", "gemini"],
    "image": ["replicate", "fal_ai"],
    "audio": ["google_genai", "fal_ai"],
    "video": ["reelmind", "gemini"],
}


def _nolanx_config() -> dict[str, Any]:
    return config_service.get_service_config("nolanx") or {}


def get_provider_router_snapshot() -> dict[str, Any]:
    cfg = _nolanx_config()
    preferences = cfg.get("provider_preferences") or {}
    custom_providers = cfg.get("custom_providers") or {}
    resolved_preferences = {
        task: list(preferences.get(task) or defaults)
        for task, defaults in DEFAULT_TASK_PROVIDER_MAP.items()
    }
    return {
        "router": cfg.get("provider_router", "nolanx"),
        "preferences": resolved_preferences,
        "custom_providers": custom_providers,
    }


def resolve_provider_choice(task_type: str, requested_provider: str | None = None) -> tuple[str, dict[str, Any]]:
    task_key = str(task_type or "text").strip().lower() or "text"
    snapshot = get_provider_router_snapshot()
    ordered = list(snapshot.get("preferences", {}).get(task_key) or DEFAULT_TASK_PROVIDER_MAP.get(task_key, ["openrouter"]))
    if requested_provider:
        requested = str(requested_provider).strip()
        if requested:
            ordered = [requested, *[provider for provider in ordered if provider != requested]]

    app_config = config_service.app_config
    for provider in ordered:
        config = app_config.get(provider)
        if isinstance(config, dict):
            return provider, config

    fallback = ordered[0] if ordered else "openrouter"
    return fallback, app_config.get(fallback, {}) or {}
