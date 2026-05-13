"""Runtime capability flags derived from current provider configuration."""

from __future__ import annotations

from typing import Any

from services.config_service import config_service


def _truthy(value: Any) -> bool:
    return bool(str(value or "").strip()) if isinstance(value, str) else bool(value)


def get_runtime_capability_flags() -> dict[str, bool]:
    app_config = config_service.app_config or {}
    openrouter = app_config.get("openrouter", {}) or {}
    fal_ai = app_config.get("fal_ai", {}) or {}
    reelmind = app_config.get("reelmind", {}) or {}
    r2_storage = app_config.get("r2_storage", {}) or {}

    text_ready = _truthy(openrouter.get("api_key"))
    image_ready = text_ready and _truthy(fal_ai.get("api_key"))
    video_ready = text_ready and _truthy(reelmind.get("api_key"))
    enhanced_storage_ready = all(
        _truthy(r2_storage.get(key))
        for key in ("account_id", "access_key_id", "secret_access_key", "bucket_name", "public_url")
    )
    script_ready = text_ready

    return {
        "text_ready": text_ready,
        "script_ready": script_ready,
        "chat_ready": text_ready,
        "image_ready": image_ready,
        "video_ready": video_ready,
        "enhanced_storage_ready": enhanced_storage_ready,
    }
