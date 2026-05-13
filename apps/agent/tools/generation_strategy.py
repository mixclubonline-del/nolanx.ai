"""
Deterministic generation strategy recommender.

This tool gives the planner concrete, state-aware recommendations:
- Whether to create NEW keyframes (image_designer) or extend existing ones (image_edit_agent)
- Whether to use single-frame image-to-video or first+last-frame-to-video (FLF)
"""

from __future__ import annotations

import json
import re
from typing import Optional, Annotated, Any

from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig

from .timeline_analyzer import get_timeline_state, CANONICAL_MEDIA_DURATION_SECONDS


class RecommendGenerationStrategyInputSchema(BaseModel):
    goal: Optional[str] = Field(
        default=None,
        description="Optional user goal/task summary. If omitted, uses the most recent user message from config.",
    )
    prefer_consistency: Optional[bool] = Field(
        default=True,
        description="When true, prefer image_edit_agent for additional keyframes once a base keyframe exists.",
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


def _last_user_text(messages: list[dict]) -> str:
    for m in reversed(messages or []):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            return m["content"]
    return ""


def _extract_any_image_url(text: str) -> Optional[str]:
    if not text:
        return None
    # Markdown style: ![image_url: ...](https://...)
    md = re.search(r"!\[image_(?:url|id):[^\]]*\]\(([^)]+)\)", text)
    if md:
        return md.group(1).strip()
    # Plain URL fallback
    url = re.search(r"https?://\\S+\\.(?:png|jpg|jpeg|webp)", text, re.IGNORECASE)
    return url.group(0).strip() if url else None


def _looks_like_transition(goal: str) -> bool:
    g = (goal or "").lower()
    hints = [
        "first last",
        "first-last",
        "start end",
        "before after",
        "before-and-after",
        "transform",
        "transition",
        "morph",
        "metamorph",
        "from ",
        "to ",
        "首尾帧",
        "首尾",
        "前后",
        "对比",
        "变化",
        "变成",
        "变为",
        "转场",
        "过渡",
    ]
    return any(h in g for h in hints)


@tool(
    "recommend_generation_strategy",
    description="Recommend keyframe/video generation strategy based on the current timeline state and the user's goal.",
    args_schema=RecommendGenerationStrategyInputSchema,
)
async def recommend_generation_strategy(
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    goal: Optional[str] = None,
    prefer_consistency: Optional[bool] = True,
) -> str:
    ctx = config.get("configurable", {}) or {}
    messages = ctx.get("messages") or []
    goal_text = goal or _last_user_text(messages)

    timeline_state = await get_timeline_state(config=config, max_assets_per_track=10)

    keyframes = (timeline_state.get("keyframes") or {}) if isinstance(timeline_state, dict) else {}
    has_keyframes = bool(keyframes.get("hasAny"))
    has_two_keyframes = bool(keyframes.get("hasTwoOrMore"))
    last_keyframe_url = keyframes.get("lastUrl")
    second_last_keyframe_url = keyframes.get("secondLastUrl")

    user_provided_image = _extract_any_image_url(goal_text)

    # Keyframe generation: if we have a base keyframe, prefer edit for consistency.
    if has_keyframes and prefer_consistency:
        keyframe_method = "edit_image"
        keyframe_input_image_url = last_keyframe_url
    elif user_provided_image and prefer_consistency:
        keyframe_method = "edit_image"
        keyframe_input_image_url = user_provided_image
    else:
        keyframe_method = "generate_image"
        keyframe_input_image_url = None

    # Video generation: use FLF if we have 2 keyframes OR user explicitly describes a transition.
    wants_transition = _looks_like_transition(goal_text)
    if (has_two_keyframes and wants_transition) or ("首尾帧" in goal_text) or ("first last" in (goal_text or "").lower()):
        video_method = "first_last_frame"
        flf_first = second_last_keyframe_url or last_keyframe_url
        flf_last = last_keyframe_url
        video_reference_strategy = "kling_o3_first_last_with_reference_pack"
    else:
        video_method = "image_to_video"
        flf_first = None
        flf_last = None
        video_reference_strategy = "kling_o3_multi_reference"

    result = {
        "canonicalMediaDurationSeconds": CANONICAL_MEDIA_DURATION_SECONDS,
        "goal": goal_text,
        "timeline": {
            "hasKeyframes": has_keyframes,
            "hasTwoKeyframes": has_two_keyframes,
            "lastKeyframeUrl": last_keyframe_url,
            "secondLastKeyframeUrl": second_last_keyframe_url,
        },
        "recommendation": {
            "keyframeMethod": keyframe_method,  # generate_image | edit_image
            "keyframeInputImageUrl": keyframe_input_image_url,
            "videoMethod": video_method,  # image_to_video | first_last_frame
            "videoReferenceStrategy": video_reference_strategy,
            "firstFrameUrl": flf_first,
            "lastFrameUrl": flf_last,
        },
        "notes": [
            "Durations are canonicalized to 15 seconds end-to-end.",
            "The preferred production order is script segmentation -> Script Track rows -> world asset design -> world asset audition-video generation -> 15-second formal shot generation.",
            "Unless the user explicitly requests a sustained take, every 15-second clip should maintain at least one meaningful subshot/camera beat every 2 seconds.",
            "Keep the whole package under one unified visual bible, one coherent dialogue language/register, and performance-first acting detail including reactions and micro-expressions.",
            "World video references should be expressed as explicit @视频N anchors for characters, locations, and props whenever possible.",
            "If keyframes exist, image_edit_agent is preferred for consistent additional keyframes.",
            "If the goal implies a visible transition and 2 keyframes exist, FLF video is preferred.",
            "Non-FLF videos use Kling O3 multi-reference reference-to-video under the hood, not legacy single-image video generation.",
        ],
    }

    return "```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```"
