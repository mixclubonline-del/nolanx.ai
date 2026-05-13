"""Hermes-style context file discovery for NolanX sessions."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from services.config_service import config_service

_MAX_CONTEXT_CHARS = 16000


def _nolanx_config() -> dict[str, Any]:
    return config_service.get_service_config("nolanx") or {}


def _workspace_root() -> Path:
    raw = str(_nolanx_config().get("workspace_root") or os.getenv("NOLANX_WORKSPACE_ROOT") or "").strip()
    if raw:
        path = Path(raw).expanduser()
        if path.exists():
            return path.resolve()

    current = Path.cwd().resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    return current


def _read_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")[:_MAX_CONTEXT_CHARS]
    except Exception:
        return ""


def _candidate_identity_files() -> list[Path]:
    configured_home = str(_nolanx_config().get("home_dir") or os.getenv("NOLANX_HOME") or "").strip()
    homes = [Path(configured_home).expanduser()] if configured_home else []
    homes.extend([Path.home() / ".nolanx", Path.home() / ".hermes", Path.home() / ".openclaw"])
    candidates: list[Path] = []
    for home in homes:
        candidates.extend([home / "SOUL.md", home / "NOLANX.md", home / "HERMES.md"])
    return candidates


def _discover_project_context_files(root: Path) -> list[Path]:
    names = [".nolanx.md", "NOLANX.md", ".hermes.md", "HERMES.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"]
    discovered: list[Path] = []
    for candidate_root in [root, *root.parents]:
        for name in names:
            candidate = candidate_root / name
            if candidate.exists():
                discovered.append(candidate)
        cursor_rules_dir = candidate_root / ".cursor" / "rules"
        if cursor_rules_dir.exists():
            discovered.extend(sorted(cursor_rules_dir.glob("*.mdc")))
        if (candidate_root / ".git").exists():
            break
    seen: set[str] = set()
    deduped: list[Path] = []
    for path in discovered:
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(path)
    return deduped


@lru_cache(maxsize=1)
def get_context_file_snapshot() -> dict[str, Any]:
    root = _workspace_root()
    identity_file = next((path for path in _candidate_identity_files() if path.exists()), None)
    project_files = _discover_project_context_files(root)
    project_entries = [
        {"path": str(path), "content": _read_file(path)}
        for path in project_files
        if _read_file(path)
    ]
    identity_content = _read_file(identity_file) if identity_file else ""
    return {
        "workspace_root": str(root),
        "identity_file": str(identity_file) if identity_file else None,
        "identity_content": identity_content,
        "project_files": project_entries,
    }


def render_context_file_instruction(snapshot: dict[str, Any] | None = None) -> str:
    snapshot = snapshot or get_context_file_snapshot()
    parts: list[str] = []
    identity_content = str(snapshot.get("identity_content") or "").strip()
    if identity_content:
        parts.append("Identity file snapshot (frozen for this session):\n" + identity_content)
    project_files = snapshot.get("project_files") or []
    if project_files:
        rendered = []
        for entry in project_files[:6]:
            path = entry.get("path")
            content = str(entry.get("content") or "").strip()
            if path and content:
                rendered.append(f"[{path}]\n{content}")
        if rendered:
            parts.append("Project context files:\n" + "\n\n".join(rendered))
    return "\n\n".join(parts).strip()
