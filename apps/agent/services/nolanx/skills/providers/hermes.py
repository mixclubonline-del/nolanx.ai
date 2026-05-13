"""Hermes-compatible skill discovery for NolanX."""

from __future__ import annotations

from pathlib import Path

from services.config_service import config_service

from ..loader import iter_skill_manifests
from ..manifest import SkillManifest


def load_hermes_skills() -> list[SkillManifest]:
    cfg = config_service.get_service_config("nolanx") or {}
    roots = [Path(str(path)).expanduser() for path in cfg.get("hermes_skill_paths", []) or []]
    roots = [path for path in roots if path.exists()]
    return list(iter_skill_manifests(roots=roots, provider="hermes"))
