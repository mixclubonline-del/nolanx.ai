"""Hermes-style frozen memory snapshots and file-backed memory mutations for NolanX."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiohttp

from services.config_service import config_service
from services.runtime_logger import log_runtime_event, log_runtime_warning

MEMORY_LIMITS = {"memory": 2200, "user": 1375}
ENTRY_SEPARATOR = "\n\n---\n\n"


def _nolanx_config() -> dict[str, Any]:
    return config_service.get_service_config("nolanx") or {}


def _memory_root() -> Path:
    configured = str(_nolanx_config().get("memory_root") or os.getenv("NOLANX_MEMORY_ROOT") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[3] / "user_data" / "nolanx-memory"


def _normalize_provider_name(provider: dict[str, Any]) -> str:
    return str(provider.get("name") or provider.get("type") or "memory_provider").strip() or "memory_provider"


def _memory_bucket(user_id: str | None) -> str:
    value = str(user_id or "default").strip() or "default"
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value)


def _memory_file(target: str, user_id: str | None) -> Path:
    normalized = "user" if target.lower().startswith("user") else "memory"
    root = _memory_root() / _memory_bucket(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / ("USER.md" if normalized == "user" else "MEMORY.md")


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 24].rstrip() + "\n\n[truncated by NolanX]"


def _read_target(target: str, user_id: str | None) -> str:
    path = _memory_file(target, user_id)
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def _write_target(target: str, user_id: str | None, content: str) -> str:
    path = _memory_file(target, user_id)
    normalized = "user" if target.lower().startswith("user") else "memory"
    limited = _truncate(content, MEMORY_LIMITS[normalized])
    path.write_text(limited + ("\n" if limited else ""), encoding="utf-8")
    return limited


def _discover_supabase_provider() -> dict[str, Any] | None:
    url = str(os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not url or not key:
        return None
    return {
        "name": "supabase_rest",
        "type": "supabase",
        "url": url.rstrip("/"),
        "service_role_key": key,
        "table": os.getenv("NOLANX_SUPABASE_MEMORY_TABLE", "nolanx_memory"),
        "user_id_field": "user_id",
        "memory_field": "memory",
        "user_field": "user_profile",
        "updated_at_field": "updated_at",
        "source": "env",
    }


def get_memory_provider_catalog() -> list[dict[str, Any]]:
    cfg = _nolanx_config()
    providers = [provider for provider in (cfg.get("memory_providers", []) or []) if isinstance(provider, dict)]
    builtins = [{"name": "file_markdown", "type": "local", "root": str(_memory_root())}]
    discovered_supabase = _discover_supabase_provider()
    if discovered_supabase is not None:
        builtins.append(discovered_supabase)
    return builtins + providers


def _split_entries(text: str) -> list[str]:
    return [entry.strip() for entry in str(text or "").split(ENTRY_SEPARATOR) if entry.strip()]


def _merge_entry_text(base: str, incoming: str) -> str:
    merged: list[str] = []
    seen: set[str] = set()
    for entry in _split_entries(base) + _split_entries(incoming):
        lowered = entry.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        merged.append(entry)
    return ENTRY_SEPARATOR.join(merged)


def get_memory_snapshot(user_id: str | None, session_id: str | None = None, canvas_id: str | None = None) -> dict[str, Any]:
    memory_text = _read_target("memory", user_id).strip()
    user_text = _read_target("user", user_id).strip()
    return {
        "user_id": user_id,
        "session_id": session_id,
        "canvas_id": canvas_id,
        "providers": get_memory_provider_catalog(),
        "files": {
            "memory": str(_memory_file("memory", user_id)),
            "user": str(_memory_file("user", user_id)),
        },
        "memory": memory_text,
        "user": user_text,
    }


async def _prefetch_supabase_provider(
    provider: dict[str, Any],
    *,
    user_id: str | None,
    session_id: str | None,
    canvas_id: str | None,
) -> dict[str, Any]:
    if not user_id:
        return {"provider": _normalize_provider_name(provider), "status": "skipped", "reason": "missing_user_id"}

    table = str(provider.get("table") or "nolanx_memory").strip()
    user_id_field = str(provider.get("user_id_field") or "user_id").strip()
    memory_field = str(provider.get("memory_field") or "memory").strip()
    user_field = str(provider.get("user_field") or "user_profile").strip()
    updated_at_field = str(provider.get("updated_at_field") or "updated_at").strip()
    url = str(provider.get("url") or "").rstrip("/")
    key = str(provider.get("service_role_key") or "").strip()
    endpoint = f"{url}/rest/v1/{table}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    params = {
        user_id_field: f"eq.{user_id}",
        "select": f"{memory_field},{user_field},{updated_at_field}",
        "limit": "1",
    }

    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(endpoint, params=params) as response:
            if response.status >= 400:
                raise ValueError(f"Supabase memory prefetch failed: HTTP {response.status}: {await response.text()}")
            payload = await response.json()

    record = payload[0] if isinstance(payload, list) and payload else {}
    remote_memory = str(record.get(memory_field) or "").strip() if isinstance(record, dict) else ""
    remote_user = str(record.get(user_field) or "").strip() if isinstance(record, dict) else ""

    merged_memory = _merge_entry_text(_read_target("memory", user_id), remote_memory)
    merged_user = _merge_entry_text(_read_target("user", user_id), remote_user)
    if merged_memory != _read_target("memory", user_id).strip():
        _write_target("memory", user_id, merged_memory)
    if merged_user != _read_target("user", user_id).strip():
        _write_target("user", user_id, merged_user)

    return {
        "provider": _normalize_provider_name(provider),
        "status": "ok",
        "fetched": bool(remote_memory or remote_user),
        "session_id": session_id,
        "canvas_id": canvas_id,
    }


async def _sync_supabase_provider(
    provider: dict[str, Any],
    *,
    user_id: str | None,
    session_id: str | None,
    canvas_id: str | None,
) -> dict[str, Any]:
    if not user_id:
        return {"provider": _normalize_provider_name(provider), "status": "skipped", "reason": "missing_user_id"}

    table = str(provider.get("table") or "nolanx_memory").strip()
    user_id_field = str(provider.get("user_id_field") or "user_id").strip()
    memory_field = str(provider.get("memory_field") or "memory").strip()
    user_field = str(provider.get("user_field") or "user_profile").strip()
    updated_at_field = str(provider.get("updated_at_field") or "updated_at").strip()
    url = str(provider.get("url") or "").rstrip("/")
    key = str(provider.get("service_role_key") or "").strip()
    endpoint = f"{url}/rest/v1/{table}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    payload = {
        user_id_field: user_id,
        memory_field: _read_target("memory", user_id).strip(),
        user_field: _read_target("user", user_id).strip(),
        updated_at_field: datetime.now(timezone.utc).isoformat(),
    }
    if session_id:
        payload["session_id"] = session_id
    if canvas_id:
        payload["canvas_id"] = canvas_id

    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.post(endpoint, params={"on_conflict": user_id_field}, json=[payload]) as response:
            if response.status >= 400:
                raise ValueError(f"Supabase memory sync failed: HTTP {response.status}: {await response.text()}")
            await response.text()

    return {
        "provider": _normalize_provider_name(provider),
        "status": "ok",
        "synced": True,
        "session_id": session_id,
        "canvas_id": canvas_id,
    }


async def prefetch_memory_snapshot(
    user_id: str | None,
    session_id: str | None = None,
    canvas_id: str | None = None,
) -> dict[str, Any]:
    reports: list[dict[str, Any]] = []
    providers = get_memory_provider_catalog()
    for provider in providers:
        provider_type = str(provider.get("type") or "").strip().lower()
        try:
            if provider_type == "supabase":
                reports.append(
                    await _prefetch_supabase_provider(
                        provider,
                        user_id=user_id,
                        session_id=session_id,
                        canvas_id=canvas_id,
                    )
                )
        except Exception as exc:
            log_runtime_warning(
                "memory.prefetch.failed",
                provider=_normalize_provider_name(provider),
                user_id=user_id,
                session_id=session_id,
                canvas_id=canvas_id,
                error=str(exc),
            )
            reports.append({"provider": _normalize_provider_name(provider), "status": "error", "error": str(exc)})

    snapshot = get_memory_snapshot(user_id=user_id, session_id=session_id, canvas_id=canvas_id)
    snapshot["prefetch_reports"] = reports
    if reports:
        log_runtime_event(
            "memory.prefetch.completed",
            user_id=user_id,
            session_id=session_id,
            canvas_id=canvas_id,
            reports=reports,
        )
    return snapshot


async def sync_memory_snapshot(
    user_id: str | None,
    session_id: str | None = None,
    canvas_id: str | None = None,
) -> dict[str, Any]:
    reports: list[dict[str, Any]] = []
    providers = get_memory_provider_catalog()
    coros = []
    provider_names: list[str] = []
    for provider in providers:
        provider_type = str(provider.get("type") or "").strip().lower()
        if provider_type == "supabase":
            provider_names.append(_normalize_provider_name(provider))
            coros.append(
                _sync_supabase_provider(
                    provider,
                    user_id=user_id,
                    session_id=session_id,
                    canvas_id=canvas_id,
                )
            )
    if coros:
        results = await asyncio.gather(*coros, return_exceptions=True)
        for provider_name, result in zip(provider_names, results):
            if isinstance(result, Exception):
                log_runtime_warning(
                    "memory.sync.failed",
                    provider=provider_name,
                    user_id=user_id,
                    session_id=session_id,
                    canvas_id=canvas_id,
                    error=str(result),
                )
                reports.append({"provider": provider_name, "status": "error", "error": str(result)})
            else:
                reports.append(result)

    snapshot = get_memory_snapshot(user_id=user_id, session_id=session_id, canvas_id=canvas_id)
    snapshot["sync_reports"] = reports
    if reports:
        log_runtime_event(
            "memory.sync.completed",
            user_id=user_id,
            session_id=session_id,
            canvas_id=canvas_id,
            reports=reports,
        )
    return snapshot


def render_memory_instruction(snapshot: dict[str, Any]) -> str:
    parts: list[str] = []
    if snapshot.get("memory"):
        parts.append("Persistent procedural memory snapshot (frozen for this session):\n" + str(snapshot["memory"]))
    if snapshot.get("user"):
        parts.append("Persistent user preference snapshot (frozen for this session):\n" + str(snapshot["user"]))
    return "\n\n".join(parts).strip()


def mutate_memory(action: str, target: str, content: str | None, user_id: str | None, old_text: str | None = None) -> dict[str, Any]:
    normalized_action = str(action or "").strip().lower()
    normalized_target = "user" if str(target or "").strip().lower().startswith("user") else "memory"
    current = _read_target(normalized_target, user_id).strip()
    entries = [entry.strip() for entry in current.split(ENTRY_SEPARATOR) if entry.strip()]
    payload = str(content or "").strip()

    if normalized_action == "status":
        return {"target": normalized_target, "content": current, "count": len(entries)}
    if normalized_action == "add":
        if payload and payload not in entries:
            entries.append(payload)
    elif normalized_action == "replace":
        needle = str(old_text or "").strip()
        if not needle:
            raise ValueError("old_text is required for replace")
        replaced = False
        for index, entry in enumerate(entries):
            if needle in entry:
                entries[index] = payload
                replaced = True
                break
        if not replaced:
            raise ValueError("No matching memory entry found for replace")
    elif normalized_action == "remove":
        needle = str(old_text or content or "").strip()
        if not needle:
            raise ValueError("content or old_text is required for remove")
        entries = [entry for entry in entries if needle not in entry]
    else:
        raise ValueError("Unsupported memory action")

    rendered = ENTRY_SEPARATOR.join(entries)
    stored = _write_target(normalized_target, user_id, rendered)
    return {
        "action": normalized_action,
        "target": normalized_target,
        "count": len([entry for entry in stored.split(ENTRY_SEPARATOR) if entry.strip()]),
        "content": stored,
    }
