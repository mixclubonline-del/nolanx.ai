"""
Handoff tool utilities for agent-to-agent transfers.
"""

import re
from typing import Annotated
from langchain_core.tools import BaseTool, InjectedToolCallId, tool
from langchain_core.messages import ToolMessage
from langgraph.prebuilt import InjectedState
from langgraph.types import Command
from langgraph_swarm.handoff import _normalize_agent_name, METADATA_KEY_HANDOFF_DESTINATION


_IMAGE_URL_RE = re.compile(r"https?://[^\s)]+", re.IGNORECASE)


def _augment_handoff_context_with_runtime_media(state: dict, context: str) -> str:
    configurable = (state or {}).get("configurable") or {}
    uploaded_image_urls = list(configurable.get("uploaded_image_urls") or [])
    uploaded_video_urls = list(configurable.get("uploaded_video_urls") or [])
    uploaded_audio_urls = list(configurable.get("uploaded_audio_urls") or [])
    user_wants_self_insert = bool(configurable.get("user_wants_self_insert"))

    if not uploaded_image_urls and not uploaded_video_urls and not uploaded_audio_urls:
        for msg in reversed((state or {}).get("messages") or []):
            content = getattr(msg, "content", "")
            if not isinstance(content, str):
                continue
            if (
                "uploaded image" not in content.lower()
                and "uploaded video" not in content.lower()
                and "uploaded audio" not in content.lower()
                and "agent-assets" not in content.lower()
            ):
                continue
            discovered_urls = _IMAGE_URL_RE.findall(content)
            uploaded_image_urls.extend(discovered_urls)
            uploaded_video_urls.extend(discovered_urls)
            uploaded_audio_urls.extend(discovered_urls)
            if uploaded_image_urls or uploaded_video_urls or uploaded_audio_urls:
                break

    parts: list[str] = [str(context or "").strip()]
    if uploaded_image_urls:
        image_lines = ", ".join(
            f"image{idx}={str(url).strip()}" for idx, url in enumerate(uploaded_image_urls[:8], start=1) if str(url).strip()
        )
        if image_lines:
            parts.append(f"uploaded_image_urls: {image_lines}")
    if uploaded_video_urls:
        video_lines = ", ".join(
            f"video{idx}={str(url).strip()}" for idx, url in enumerate(uploaded_video_urls[:8], start=1) if str(url).strip()
        )
        if video_lines:
            parts.append(f"uploaded_video_urls: {video_lines}")
    if uploaded_audio_urls:
        audio_lines = ", ".join(
            f"audio{idx}={str(url).strip()}" for idx, url in enumerate(uploaded_audio_urls[:8], start=1) if str(url).strip()
        )
        if audio_lines:
            parts.append(f"uploaded_audio_urls: {audio_lines}")
    if user_wants_self_insert:
        parts.append(
            "user_wants_self_insert: true; if the request is story/script/world design related, treat uploaded images as identity anchors for the user appearing on screen"
        )
    if uploaded_image_urls or uploaded_video_urls or uploaded_audio_urls:
        parts.append("Do not infer semantic identity from raw asset ids; use explicit image N / video N / audio N mappings only.")
    return " | ".join(part for part in parts if part)


def _augment_handoff_context_with_agent_skills(state: dict, agent_name: str, context: str) -> str:
    configurable = (state or {}).get("configurable") or {}
    agent_auto_skill_map = configurable.get("agent_auto_skill_map") or {}
    auto_skills = configurable.get("auto_skills") or []
    targeted_skills = []
    if isinstance(agent_auto_skill_map, dict):
        targeted_skills = list(agent_auto_skill_map.get(agent_name) or [])
    if not targeted_skills and isinstance(auto_skills, list):
        targeted_skills = list(auto_skills)

    if not targeted_skills:
        return context

    labels = []
    for skill in targeted_skills[:6]:
        name = str((skill or {}).get("name") or "").strip()
        if name:
            labels.append(name)
    if not labels:
        return context

    parts = [str(context or "").strip(), f"active_skills_for_{agent_name}: " + ", ".join(labels)]
    return " | ".join(part for part in parts if part)


def create_handoff_tool(
    *, agent_name: str, name: str | None = None, description: str | None = None
) -> BaseTool:
    """Create a tool that can handoff control to the requested agent.

    Args:
        agent_name: The name of the agent to handoff control to, i.e.
            the name of the agent node in the multi-agent graph.
            Agent names should be simple, clear and unique, preferably in snake_case,
            although you are only limited to the names accepted by LangGraph
            nodes as well as the tool names accepted by LLM providers
            (the tool name will look like this: `transfer_to_<agent_name>`).
        name: Optional name of the tool to use for the handoff.
            If not provided, the tool name will be `transfer_to_<agent_name>`.
        description: Optional description for the handoff tool.
            If not provided, the tool description will be `Ask agent <agent_name> for help`.
    """
    if name is None:
        name = f"transfer_to_{_normalize_agent_name(agent_name)}"

    if description is None:
        description = f"Ask agent '{agent_name}' for help"

    @tool(name, description=description+"""
    \nIMPORTANT RULES:
            1. You MUST complete the other tool calls and wait for their result BEFORE attempting to transfer to another agent
            2. Do NOT call this handoff tool with other tools simultaneously
            3. Always wait for the result of other tool calls before making this handoff call
    """)
    def handoff_to_agent(
        state: Annotated[dict, InjectedState],
        tool_call_id: Annotated[str, InjectedToolCallId],
        context: str = "",
    ):
        # Extract context from recent messages if not provided
        if not context and state.get("messages"):
            recent_messages = state["messages"][-5:]  # Get last 5 messages for context
            context_parts = []
            for msg in recent_messages:
                if hasattr(msg, 'content') and msg.content:
                    # Extract key information from messages
                    content = str(msg.content)
                    if any(keyword in content.lower() for keyword in ['故事', 'story', '猫', 'cat', '生成', 'generate']):
                        context_parts.append(content[:200])  # Limit length
            context = " | ".join(context_parts) if context_parts else "Continue the current task"

        context = _augment_handoff_context_with_runtime_media(state, context)
        context = _augment_handoff_context_with_agent_skills(state, agent_name, context)
        transfer_message = f"<hide_in_user_ui> Successfully transferred to {agent_name}. Context: {context}"

        tool_message = ToolMessage(
            content=transfer_message,
            name=name,
            tool_call_id=tool_call_id,
        )

        return Command(
            goto=agent_name,
            graph=Command.PARENT,
            # Use full message list update to avoid any chance of dropping history during handoff.
            # Tool-call parallelism is handled by the agent post_model_hook.
            update={"messages": state["messages"] + [tool_message], "active_agent": agent_name},
        )

    handoff_to_agent.metadata = {METADATA_KEY_HANDOFF_DESTINATION: agent_name}
    return handoff_to_agent
