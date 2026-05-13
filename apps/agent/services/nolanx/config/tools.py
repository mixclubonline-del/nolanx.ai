"""Tool registry and provider router for NolanX agents."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.tools import tool

from services.runtime_logger import log_runtime_event
from tools.audio_generators import generate_audio
from tools.code_execution_generators import execute_code
from tools.document_analyzer import analyze_documents
from tools.function_calling_generators import execute_function_call
from tools.generation_strategy import recommend_generation_strategy
from tools.image_edit import edit_image
from tools.image_generators import generate_image
from tools.media_analyzer import analyze_media
from tools.music_generators import generate_music
from tools.search_generators import search_and_generate
from tools.storyboard_executor import execute_storyboard
from tools.structured_output_generators import generate_structured_output
from tools.timeline_analyzer import analyze_timeline_state
from tools.tts_generators import generate_tts_audio
from tools.video_generators import generate_video, generate_video_first_last_frame
from tools.web_context_analyzer import analyze_web_context
from tools.write_plan import write_plan_tool

from ..bridges import get_acp_bridge_catalog, invoke_acp_bridge
from ..memory import get_memory_provider_catalog, get_memory_snapshot, mutate_memory
from ..providers import get_provider_router_snapshot
from ..runtime_capabilities import get_runtime_capability_flags
from ..skills import (
    call_configured_mcp_tool,
    filter_skills_for_agent,
    get_mcp_server_catalog,
    get_skill_manifest,
    install_local_skill,
    load_skill_catalog,
)

ToolFn = Callable[..., Any]


@tool("list_skills")
def list_skills(agent_name: str = "") -> dict[str, Any]:
    """List NolanX/OpenClaw/Hermes skills available to a given agent."""
    skills = get_skill_catalog_snapshot(agent_name=agent_name or None)
    return {
        "agent_name": agent_name or None,
        "count": len(skills),
        "skills": skills,
    }


@tool("activate_skill")
def activate_skill(skill_name: str, task: str = "", agent_name: str = "") -> dict[str, Any]:
    """Load a skill's instructions so an agent can apply it to the current task."""
    manifest = get_skill_manifest(skill_name)
    if manifest is None:
        raise ValueError(f"Skill '{skill_name}' was not found")
    return {
        "skill": manifest.summary(),
        "agent_name": agent_name or None,
        "task": task,
        "instructions": manifest.instructions,
    }


@tool("install_local_skill")
def install_local_skill_tool(source_path: str, skill_name: str = "") -> dict[str, Any]:
    """Install a local SKILL.md file or skill directory into NolanX managed skill imports."""
    return install_local_skill(source_path=source_path, skill_name=skill_name)


@tool("list_mcp_servers")
def list_mcp_servers() -> dict[str, Any]:
    """List configured MCP servers available to NolanX."""
    servers = get_mcp_server_catalog()
    return {"count": len(servers), "servers": servers}


@tool("call_mcp_tool")
async def call_mcp_tool(server_name: str, tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call a configured MCP server tool through NolanX's provider router."""
    return await call_configured_mcp_tool(server_name=server_name, tool_name=tool_name, arguments=arguments)


@tool("list_memory_providers")
def list_memory_providers() -> dict[str, Any]:
    """List configured NolanX memory providers."""
    providers = get_memory_provider_catalog()
    return {"count": len(providers), "providers": providers}


@tool("get_memory_snapshot")
def get_memory_snapshot_tool(user_id: str = "", session_id: str = "", canvas_id: str = "") -> dict[str, Any]:
    """Read the current frozen memory snapshot for a user/session."""
    return get_memory_snapshot(user_id=user_id or None, session_id=session_id or None, canvas_id=canvas_id or None)


@tool("mutate_memory")
def mutate_memory_tool(
    action: str,
    target: str,
    content: str = "",
    user_id: str = "",
    old_text: str = "",
) -> dict[str, Any]:
    """Mutate NolanX file-backed memory using add/replace/remove/status."""
    return mutate_memory(
        action=action,
        target=target,
        content=content,
        user_id=user_id or None,
        old_text=old_text or None,
    )


@tool("list_model_providers")
def list_model_providers() -> dict[str, Any]:
    """List NolanX provider-router preferences and custom providers."""
    snapshot = get_provider_router_snapshot()
    return snapshot


@tool("list_acp_bridges")
def list_acp_bridges() -> dict[str, Any]:
    """List configured ACP bridges for OpenClaw/Hermes compatible runtimes."""
    bridges = get_acp_bridge_catalog()
    return {"count": len(bridges), "bridges": bridges}


@tool("invoke_acp_bridge")
async def invoke_acp_bridge_tool(
    bridge_name: str,
    operation: str,
    payload: dict[str, Any] | None = None,
    session_id: str = "",
    canvas_id: str = "",
    user_id: str = "",
) -> dict[str, Any]:
    """Invoke a configured ACP gateway/runtime bridge."""
    return await invoke_acp_bridge(
        bridge_name=bridge_name,
        operation=operation,
        payload=payload,
        session_id=session_id or None,
        canvas_id=canvas_id or None,
        user_id=user_id or None,
    )


def get_builtin_tool_mapping() -> dict[str, ToolFn]:
    flags = get_runtime_capability_flags()
    mapping: dict[str, ToolFn] = {
        "execute_code": execute_code,
        "analyze_documents": analyze_documents,
        "generate_structured_output": generate_structured_output,
        "analyze_media": analyze_media,
        "execute_function_call": execute_function_call,
        "analyze_web_context": analyze_web_context,
        "search_and_generate": search_and_generate,
        "write_plan": write_plan_tool,
        "analyze_timeline_state": analyze_timeline_state,
        "recommend_generation_strategy": recommend_generation_strategy,
    }

    if flags["text_ready"]:
        mapping["execute_storyboard"] = execute_storyboard

    if flags["image_ready"]:
        mapping["generate_image"] = generate_image
        mapping["edit_image"] = edit_image

    if flags["video_ready"]:
        mapping["generate_video"] = generate_video
        mapping["generate_video_first_last_frame"] = generate_video_first_last_frame

    if flags["video_ready"] and flags["enhanced_storage_ready"]:
        mapping["generate_audio"] = generate_audio
        mapping["generate_tts_audio"] = generate_tts_audio
        mapping["generate_music"] = generate_music

    return mapping


def get_skill_catalog_snapshot(agent_name: str | None = None) -> list[dict[str, Any]]:
    filtered = filter_skills_for_agent(load_skill_catalog(), agent_name)
    return [skill.summary() for skill in filtered]


def get_external_tool_mapping() -> dict[str, ToolFn]:
    return {
        "list_skills": list_skills,
        "activate_skill": activate_skill,
        "install_local_skill": install_local_skill_tool,
        "list_mcp_servers": list_mcp_servers,
        "call_mcp_tool": call_mcp_tool,
        "list_memory_providers": list_memory_providers,
        "get_memory_snapshot": get_memory_snapshot_tool,
        "mutate_memory": mutate_memory_tool,
        "list_model_providers": list_model_providers,
        "list_acp_bridges": list_acp_bridges,
        "invoke_acp_bridge": invoke_acp_bridge_tool,
    }


def get_tool_mapping() -> dict[str, ToolFn]:
    mapping = get_builtin_tool_mapping()
    mapping.update(get_external_tool_mapping())
    return mapping


def get_capability_snapshot(agent_name: str | None = None) -> dict[str, Any]:
    skill_catalog = get_skill_catalog_snapshot(agent_name=agent_name)
    mcp_servers = get_mcp_server_catalog()
    memory_providers = get_memory_provider_catalog()
    provider_router = get_provider_router_snapshot()
    acp_bridges = get_acp_bridge_catalog()
    tool_mapping = get_tool_mapping()
    return {
        "agent_name": agent_name,
        "tool_count": len(tool_mapping),
        "builtin_tool_count": len(get_builtin_tool_mapping()),
        "external_tool_count": len(get_external_tool_mapping()),
        "runtime_capabilities": get_runtime_capability_flags(),
        "skills": skill_catalog,
        "mcp_servers": mcp_servers,
        "memory_providers": memory_providers,
        "provider_router": provider_router,
        "acp_bridges": acp_bridges,
    }


def create_tool(tool_config: dict):
    """Resolve a tool from NolanX's provider registry."""
    tool_mapping = get_tool_mapping()
    tool_name = str(tool_config.get("tool") or "").strip()
    resolved_tool = tool_mapping.get(tool_name)

    log_runtime_event(
        "tool.resolved",
        tool_name=tool_name,
        loaded=resolved_tool is not None,
        declared=tool_name in tool_mapping,
        source=("builtin" if tool_name in get_builtin_tool_mapping() else "provider") if resolved_tool else "missing",
    )
    return resolved_tool
