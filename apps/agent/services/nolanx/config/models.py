"""Model and runnable configuration for NolanX agents."""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from services.config_service import config_service
from services.runtime_logger import log_runtime_event
from utils.http_client import HttpClient

from ..bridges import build_acp_bridge_state
from ..context_files import get_context_file_snapshot
from ..memory import get_memory_snapshot, prefetch_memory_snapshot
from ..providers import get_provider_router_snapshot, resolve_provider_choice
from ..runtime import get_runtime_profile
from .tools import get_capability_snapshot


def get_model_config():
    """Get default model configuration."""
    provider, provider_config = resolve_provider_choice("text")
    return {
        "provider": provider,
        "url": provider_config.get("url", "https://openrouter.ai/api/v1"),
        "model": provider_config.get("model", "google/gemini-3.1-pro-preview"),
        "max_tokens": provider_config.get("max_tokens", 8192),
        "temperature": provider_config.get("temperature", 0.1),
        "disable_streaming": bool(provider_config.get("disable_streaming", True)),
        "http_timeout_seconds": int(provider_config.get("agent_http_timeout_seconds", 180) or 180),
        "model_timeout_seconds": int(provider_config.get("agent_model_timeout_seconds", 120) or 120),
        "runnable_retry_attempts": int(provider_config.get("agent_runnable_retry_attempts", 2) or 2),
    }


def get_image_model_config():
    return {
        "provider": "replicate",
        "model": "black-forest-labs/flux-kontext-pro",
        "url": "https://api.replicate.com/v1/",
        "type": "image",
    }


def get_audio_model_config():
    return {"provider": "fal_ai", "model": ""}


def get_video_model_config():
    return {"provider": "reelmind", "model": "dreamina-seedance-2-0-260128"}


def create_llm_model():
    """Create and configure the LLM model instance."""
    model_config = get_model_config()

    provider = model_config["provider"]
    api_key = config_service.app_config.get(provider, {}).get("api_key", "")
    max_retries = int(config_service.app_config.get(provider, {}).get("max_retries", 3) or 3)
    http_timeout_seconds = int(model_config.get("http_timeout_seconds", 180) or 180)
    model_timeout_seconds = int(model_config.get("model_timeout_seconds", 120) or 120)
    runnable_retry_attempts = int(model_config.get("runnable_retry_attempts", 2) or 2)

    http_client = HttpClient.create_sync_client(timeout=http_timeout_seconds)
    http_async_client = HttpClient.create_async_client(timeout=http_timeout_seconds)

    extra_headers = {}
    if provider == "openrouter":
        openrouter_config = config_service.app_config.get("openrouter", {})
        extra_headers = {
            "HTTP-Referer": openrouter_config.get("site_url", "https://reelmind.ai"),
            "X-Title": openrouter_config.get("site_name", "ReelMind"),
        }

    model = ChatOpenAI(
        model=model_config["model"],
        api_key=api_key,
        timeout=model_timeout_seconds,
        max_retries=max_retries,
        base_url=model_config["url"],
        temperature=model_config["temperature"],
        max_tokens=model_config["max_tokens"],
        streaming=False,
        disable_streaming=model_config.get("disable_streaming", True),
        http_client=http_client,
        http_async_client=http_async_client,
        default_headers=extra_headers,
    )

    log_runtime_event(
        "model.initialized",
        provider=provider,
        model=model_config["model"],
        max_tokens=model_config["max_tokens"],
        temperature=model_config["temperature"],
        http_timeout_seconds=http_timeout_seconds,
        model_timeout_seconds=model_timeout_seconds,
        provider_max_retries=max_retries,
        runnable_retry_attempts=runnable_retry_attempts,
    )

    return model


def create_context_config(
    canvas_id: str,
    session_id: str,
    user_id: str,
    preferred_language: str | None = None,
    preferred_language_instruction: str | None = None,
    messages: list | None = None,
    uploaded_image_urls: list[str] | None = None,
    uploaded_video_urls: list[str] | None = None,
    uploaded_audio_urls: list[str] | None = None,
    user_wants_self_insert: bool | None = None,
    interrupted_tool_call: dict | None = None,
    auto_skills: list[dict] | None = None,
    agent_auto_skill_map: dict[str, list[dict]] | None = None,
):
    """Create runnable config for NolanX agents."""
    runtime_profile = get_runtime_profile()
    capability_snapshot = get_capability_snapshot(agent_name="planner")
    provider_router_snapshot = get_provider_router_snapshot()
    context_file_snapshot = get_context_file_snapshot()
    thread_id = session_id or canvas_id or user_id
    checkpoint_ns = f"canvas:{canvas_id}" if canvas_id else "global"
    memory_snapshot = get_memory_snapshot(user_id=user_id, session_id=session_id, canvas_id=canvas_id)
    acp_bridge_state = build_acp_bridge_state(session_id=session_id, canvas_id=canvas_id, user_id=user_id)

    return {
        "configurable": {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "canvas_id": canvas_id,
            "session_id": session_id,
            "user_id": user_id,
            "preferred_language": preferred_language or "en",
            "preferred_language_instruction": preferred_language_instruction or "",
            "messages": list(messages or []),
            "uploaded_image_urls": list(uploaded_image_urls or []),
            "uploaded_video_urls": list(uploaded_video_urls or []),
            "uploaded_audio_urls": list(uploaded_audio_urls or []),
            "user_wants_self_insert": bool(user_wants_self_insert),
            "interrupted_tool_call": dict(interrupted_tool_call or {}) if isinstance(interrupted_tool_call, dict) else {},
            "auto_skills": list(auto_skills or []),
            "agent_auto_skill_map": dict(agent_auto_skill_map or {}),
            "runtime_profile": runtime_profile,
            "capability_snapshot": capability_snapshot,
            "provider_router_snapshot": provider_router_snapshot,
            "context_file_snapshot": context_file_snapshot,
            "memory_snapshot": memory_snapshot,
            "acp_bridge_state": acp_bridge_state,
            "model_info": {
                "image": get_image_model_config(),
                "audio": get_audio_model_config(),
                "video": get_video_model_config(),
            },
        },
        "recursion_limit": int(config_service.app_config.get("openrouter", {}).get("agent_recursion_limit", 60) or 60),
    }


async def refresh_context_memory(
    *,
    user_id: str | None,
    session_id: str | None,
    canvas_id: str | None,
    ctx: dict,
) -> dict:
    """Refresh context memory snapshot after external provider prefetch."""
    snapshot = await prefetch_memory_snapshot(user_id=user_id, session_id=session_id, canvas_id=canvas_id)
    configurable = ctx.setdefault("configurable", {})
    configurable["memory_snapshot"] = snapshot
    return snapshot
