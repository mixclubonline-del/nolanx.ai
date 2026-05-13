"""Skill exposure policy for NolanX agents."""

from __future__ import annotations

import os
import shutil
import sys
from typing import Any, Iterable

from services.config_service import config_service

from .manifest import SkillManifest


DEFAULT_AGENT_ALLOWLIST = {"planner", "function_calling_agent", "code_execution_agent", "web_context_agent", "search_agent"}


def _nolanx_config() -> dict:
    return config_service.get_service_config("nolanx") or {}


def _config_has_path(data: dict[str, Any], dotted_path: str) -> bool:
    cursor: Any = data
    for segment in str(dotted_path or "").split("."):
        if not segment:
            continue
        if not isinstance(cursor, dict) or segment not in cursor:
            return False
        cursor = cursor[segment]
    return True


def _matches_os(expected: Any) -> bool:
    if isinstance(expected, str):
        expected = [expected]
    values = {str(item).strip().lower() for item in (expected or []) if str(item).strip()}
    if not values:
        return True
    current = sys.platform.lower()
    return any(value in current for value in values)


def _requirements_block(skill: SkillManifest) -> dict[str, Any]:
    metadata = skill.metadata or {}
    for key in ("requires", "openclaw", "hermes", "nolanx"):
        block = metadata.get(key)
        if key == "requires" and isinstance(block, dict):
            return block
        if isinstance(block, dict) and isinstance(block.get("requires"), dict):
            return block.get("requires") or {}
    return {}


def _is_skill_runnable(skill: SkillManifest) -> bool:
    metadata = skill.metadata or {}
    if metadata.get("disabled") is True:
        return False
    requirements = _requirements_block(skill)
    if requirements.get("always") is False:
        return False

    expected_os = requirements.get("os")
    if expected_os and not _matches_os(expected_os):
        return False

    bins = requirements.get("bins") or []
    if isinstance(bins, str):
        bins = [bins]
    if any(not shutil.which(str(binary)) for binary in bins):
        return False

    env_requirements = requirements.get("env") or []
    if isinstance(env_requirements, str):
        env_requirements = [env_requirements]
    if isinstance(env_requirements, dict):
        env_requirements = list(env_requirements.keys())
    if any(not os.getenv(str(name)) for name in env_requirements):
        return False

    config_requirements = requirements.get("config") or []
    if isinstance(config_requirements, str):
        config_requirements = [config_requirements]
    cfg = _nolanx_config()
    if any(not _config_has_path(cfg, str(path)) for path in config_requirements):
        return False

    return True


def _allows_agent(skill: SkillManifest, agent_name: str | None) -> bool:
    agent = str(agent_name or "").strip()
    provider_block = _nolanx_config().get("skill_policy", {}) or {}
    denied_agents = set(provider_block.get("deny_agents", []) or [])
    allowed_agents = set(provider_block.get("allow_agents", []) or [])

    if agent and agent in denied_agents:
        return False
    if allowed_agents and agent and agent not in allowed_agents:
        return False
    if not allowed_agents and agent and agent not in DEFAULT_AGENT_ALLOWLIST:
        return False

    skill_agents = skill.metadata.get("agents") or {}
    if isinstance(skill_agents, dict):
        allow = set(str(item) for item in (skill_agents.get("allow") or []))
        deny = set(str(item) for item in (skill_agents.get("deny") or []))
        if agent and agent in deny:
            return False
        if allow and agent and agent not in allow:
            return False

    return True


def is_skill_enabled_for_agent(skill: SkillManifest, agent_name: str | None) -> bool:
    cfg = _nolanx_config()
    if not cfg.get("skills_enabled", True):
        return False
    return _is_skill_runnable(skill) and _allows_agent(skill, agent_name)


def filter_skills_for_agent(skills: Iterable[SkillManifest], agent_name: str | None) -> list[SkillManifest]:
    filtered = [skill for skill in skills if is_skill_enabled_for_agent(skill, agent_name)]
    return sorted(filtered, key=lambda item: (-item.source_rank, item.name.lower()))
