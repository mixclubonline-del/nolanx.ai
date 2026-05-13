"""Load NolanX-compatible skills from local folders and SKILL.md bundles."""

from __future__ import annotations

import os
import re
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import yaml

from services.config_service import config_service

from .manifest import SkillManifest

_FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_TITLE_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_BULLET_TAGS_RE = re.compile(r"^[-*]\s+([A-Za-z0-9_./:-]+)\s*$", re.MULTILINE)


SOURCE_RANKS = {
    "extra": 10,
    "bundled": 20,
    "managed": 30,
    "personal": 40,
    "project": 50,
    "workspace": 60,
}


def _nolanx_config() -> dict:
    return config_service.get_service_config("nolanx") or {}


def _dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    deduped: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        resolved = str(path.expanduser().resolve()) if path.exists() else str(path.expanduser())
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(path.expanduser())
    return deduped


def _discover_workspace_root() -> Path | None:
    cfg = _nolanx_config()
    raw = str(cfg.get("workspace_root") or os.getenv("NOLANX_WORKSPACE_ROOT") or "").strip()
    if raw:
        path = Path(raw).expanduser()
        if path.exists():
            return path

    current = Path.cwd().resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    return current if current.exists() else None


def _source_roots() -> list[tuple[str, Path]]:
    cfg = _nolanx_config()
    workspace_root = _discover_workspace_root()
    roots: list[tuple[str, Path]] = []

    raw_extra_paths = list(cfg.get("skill_paths", []) or [])
    env_paths = os.getenv("NOLANX_SKILLS_PATHS", "")
    if env_paths:
        raw_extra_paths.extend([part for part in env_paths.split(os.pathsep) if part.strip()])
    for path in _dedupe_paths(Path(str(raw)).expanduser() for raw in raw_extra_paths):
        if path.exists():
            roots.append(("extra", path))

    bundled_paths = [
        Path.home() / ".codex" / "skills",
        Path.home() / ".nolanx" / "skills",
    ]
    for path in _dedupe_paths(bundled_paths):
        if path.exists():
            roots.append(("bundled", path))

    managed_paths = [
        Path.home() / ".hermes" / "skills",
        Path.home() / ".hermes" / "skills" / "openclaw-imports",
        Path.home() / ".openclaw" / "skills",
    ]
    for path in _dedupe_paths(managed_paths):
        if path.exists():
            roots.append(("managed", path))

    personal_paths = [
        Path.home() / ".agents" / "skills",
        Path.home() / ".config" / "nolanx" / "skills",
    ]
    for path in _dedupe_paths(personal_paths):
        if path.exists():
            roots.append(("personal", path))

    if workspace_root:
        project_paths = [workspace_root / ".agents" / "skills", workspace_root / ".nolanx" / "skills"]
        for path in _dedupe_paths(project_paths):
            if path.exists():
                roots.append(("project", path))

        workspace_paths = [workspace_root / "skills"]
        for path in _dedupe_paths(workspace_paths):
            if path.exists():
                roots.append(("workspace", path))

    return roots


def _managed_import_root() -> Path:
    cfg = _nolanx_config()
    raw = str(cfg.get("managed_skill_root") or os.getenv("NOLANX_MANAGED_SKILL_ROOT") or "").strip()
    root = Path(raw).expanduser() if raw else Path.home() / ".nolanx" / "skills" / "imports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _slugify_skill_name(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-._")
    return slug or "imported-skill"


def _extract_front_matter_metadata(text: str) -> dict:
    match = _FRONT_MATTER_RE.match(text)
    if not match:
        return {}
    try:
        parsed = yaml.safe_load(match.group(1)) or {}
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _extract_title(text: str, fallback: str) -> str:
    match = _TITLE_RE.search(text)
    if match:
        return match.group(1).strip()
    return fallback


def _extract_description(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if line.startswith("#"):
            continue
        if len(line) >= 12:
            return line[:400]
    return ""


def _extract_tags(text: str, metadata: dict) -> list[str]:
    tags: list[str] = []
    configured_tags = metadata.get("tags") or []
    if isinstance(configured_tags, list):
        tags.extend(str(tag).strip() for tag in configured_tags if str(tag).strip())
    for match in _BULLET_TAGS_RE.finditer(text):
        tag = match.group(1).strip()
        if len(tag) <= 40 and tag.lower() not in {"usage", "workflow", "notes"}:
            tags.append(tag)
    deduped: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        lowered = tag.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(tag)
    return deduped[:12]


def _manifest_from_skill_file(skill_file: Path, provider: str = "local", source: str = "workspace") -> SkillManifest:
    text = skill_file.read_text(encoding="utf-8")
    metadata = _extract_front_matter_metadata(text)
    title = str(metadata.get("name") or _extract_title(text, skill_file.parent.name)).strip()
    description = str(metadata.get("description") or _extract_description(text)).strip()
    tags = _extract_tags(text, metadata)
    return SkillManifest(
        name=title,
        path=str(skill_file.parent),
        provider=provider,
        source=source,
        source_rank=SOURCE_RANKS.get(source, 0),
        description=description,
        tags=tags,
        metadata=metadata,
        instructions=text[:12000],
    )


def iter_skill_manifests(roots: Iterable[Path] | None = None, provider: str = "local", source: str = "workspace"):
    seen: set[str] = set()
    iterable = [(source, path) for path in roots] if roots is not None else _source_roots()
    for source_name, root in iterable:
        if root.is_file() and root.name == "SKILL.md":
            key = str(root.resolve())
            if key in seen:
                continue
            seen.add(key)
            try:
                yield _manifest_from_skill_file(root, provider=provider, source=source_name)
            except Exception:
                continue
            continue
        if not root.is_dir():
            continue
        for skill_file in root.rglob("SKILL.md"):
            key = str(skill_file.resolve())
            if key in seen:
                continue
            seen.add(key)
            try:
                yield _manifest_from_skill_file(skill_file, provider=provider, source=source_name)
            except Exception:
                continue


@lru_cache(maxsize=1)
def load_skill_catalog() -> list[SkillManifest]:
    manifests = list(iter_skill_manifests())
    selected: dict[str, SkillManifest] = {}
    for manifest in sorted(manifests, key=lambda item: item.source_rank):
        key = manifest.name.strip().lower() or Path(manifest.path).name.lower()
        selected[key] = manifest
    return sorted(selected.values(), key=lambda item: (-item.source_rank, item.name.lower()))


def get_skill_manifest(skill_name: str) -> SkillManifest | None:
    normalized = str(skill_name or "").strip().lower()
    if not normalized:
        return None
    for skill in load_skill_catalog():
        names = {skill.name.lower(), Path(skill.path).name.lower()}
        aliases = skill.metadata.get("aliases") or []
        if isinstance(aliases, list):
            names.update(str(alias).strip().lower() for alias in aliases if str(alias).strip())
        if normalized in names:
            return skill
    return None


def install_local_skill(source_path: str, skill_name: str = "") -> dict:
    source = Path(str(source_path or "").strip()).expanduser()
    if not source.exists():
        raise ValueError(f"Skill source was not found: {source}")

    if source.is_file():
        if source.name != "SKILL.md":
            raise ValueError("Local skill import expects a SKILL.md file or a directory containing SKILL.md")
        source_dir = source.parent
        source_skill_file = source
    else:
        source_dir = source
        source_skill_file = source / "SKILL.md"
        if not source_skill_file.exists():
            raise ValueError(f"Directory does not contain SKILL.md: {source}")

    manifest = _manifest_from_skill_file(source_skill_file, provider="local", source="extra")
    slug = _slugify_skill_name(skill_name or manifest.name or source_dir.name)
    destination = _managed_import_root() / slug
    if destination.exists():
        raise ValueError(f"Skill destination already exists: {destination}")

    if source_dir.is_dir():
        shutil.copytree(source_dir, destination)
    else:
        destination.mkdir(parents=True, exist_ok=False)
        shutil.copy2(source_skill_file, destination / "SKILL.md")

    load_skill_catalog.cache_clear()
    installed = _manifest_from_skill_file(destination / "SKILL.md", provider="local", source="managed")
    return {
        "installed": True,
        "source_path": str(source_skill_file),
        "installed_path": str(destination),
        "skill": installed.summary(),
    }
