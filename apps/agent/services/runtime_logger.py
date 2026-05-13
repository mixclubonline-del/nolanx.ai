"""
Structured runtime logging helpers for ReelMind Python services.
"""

from __future__ import annotations

import json
import logging
import sys
import traceback
from typing import Any


logger = logging.getLogger("reelmind.runtime")

_MAX_STRING_LENGTH = 600
_MAX_ARRAY_ITEMS = 10
_MAX_OBJECT_KEYS = 20
_MAX_DEPTH = 4
_LOGGER_INITIALIZED = False


def setup_runtime_logging(level: int = logging.INFO) -> None:
    global _LOGGER_INITIALIZED
    if _LOGGER_INITIALIZED:
        logger.setLevel(level)
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter("%(message)s"))

    logger.setLevel(level)
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.propagate = False
    _LOGGER_INITIALIZED = True


def _has_visible_content(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _sanitize(value: Any, depth: int = 0) -> Any:
    if value is None:
        return value

    if isinstance(value, bytes):
        return "[bytes omitted]"

    if isinstance(value, str):
        if len(value) <= _MAX_STRING_LENGTH:
            return value
        return f"{value[:_MAX_STRING_LENGTH]}... [truncated {len(value) - _MAX_STRING_LENGTH} chars]"

    if isinstance(value, (int, float, bool)):
        return value

    if depth >= _MAX_DEPTH:
        return "[max depth reached]"

    if isinstance(value, (list, tuple, set)):
        items = list(value)
        sanitized = [_sanitize(item, depth + 1) for item in items[:_MAX_ARRAY_ITEMS]]
        if len(items) > _MAX_ARRAY_ITEMS:
            sanitized.append(f"[+{len(items) - _MAX_ARRAY_ITEMS} more items]")
        return sanitized

    if isinstance(value, dict):
        sanitized_dict: dict[str, Any] = {}
        entries = list(value.items())
        for key, nested in entries[:_MAX_OBJECT_KEYS]:
            sanitized_dict[str(key)] = _sanitize(nested, depth + 1)
        if len(entries) > _MAX_OBJECT_KEYS:
            sanitized_dict["__truncated_keys"] = len(entries) - _MAX_OBJECT_KEYS
        return sanitized_dict

    try:
        return _sanitize(vars(value), depth + 1)
    except Exception:
        return str(value)


def _format_field(key: str, value: Any) -> list[str]:
    sanitized = _sanitize(value)
    if isinstance(sanitized, (dict, list)):
        formatted = json.dumps(sanitized, ensure_ascii=False, indent=2)
        return [f"  {key}:"] + [f"    {line}" for line in formatted.splitlines()]
    return [f"  {key}: {sanitized}"]


def log_runtime_event(event: str, /, **fields: Any) -> None:
    lines = [f"[NolanXRuntime] {event}"]
    for key, value in fields.items():
        if _has_visible_content(value):
            lines.extend(_format_field(key, value))
    logger.info("\n".join(lines))


def log_runtime_warning(event: str, /, **fields: Any) -> None:
    lines = [f"[NolanXRuntime] {event}"]
    for key, value in fields.items():
        if _has_visible_content(value):
            lines.extend(_format_field(key, value))
    logger.warning("\n".join(lines))


def log_runtime_error(event: str, /, error: Any, **fields: Any) -> None:
    lines = [f"[NolanXRuntime] {event}"]
    lines.extend(_format_field("error", str(error)))
    for key, value in fields.items():
        if _has_visible_content(value):
            lines.extend(_format_field(key, value))
    logger.error("\n".join(lines))


def log_runtime_exception(event: str, /, error: Exception, **fields: Any) -> None:
    lines = [f"[NolanXRuntime] {event}"]
    lines.extend(_format_field("error", str(error)))
    lines.extend(_format_field("traceback", traceback.format_exc()))
    for key, value in fields.items():
        if _has_visible_content(value):
            lines.extend(_format_field(key, value))
    logger.exception("\n".join(lines))


def log_agent_created(agent_name: str, tools: list[Any], handoff_tools: list[Any]) -> None:
    log_runtime_event(
        "agent.created",
        agent_name=agent_name,
        tool_count=len(tools),
        tools=[getattr(tool, "name", str(tool)) for tool in tools],
        handoff_count=len(handoff_tools),
        handoff_tools=[getattr(tool, "name", str(tool)) for tool in handoff_tools],
    )
