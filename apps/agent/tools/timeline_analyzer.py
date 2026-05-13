"""
Timeline state analyzer tool.

Used by the planner to make state-aware decisions (image vs edit, single-frame vs FLF, etc.).
"""

from __future__ import annotations

import json
from typing import Optional, Annotated, Any

from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig

from services.api_client_service import api_client_service


CANONICAL_MEDIA_DURATION_SECONDS = 15


class AnalyzeTimelineStateInputSchema(BaseModel):
    max_assets_per_track: Optional[int] = Field(
        default=10,
        ge=1,
        le=50,
        description="How many most-recent assets to include per track in the summary.",
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


def _safe_get(dct: Any, *path: str, default=None):
    cur = dct
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return cur if cur is not None else default


def _summarize_assets(track_id: str, assets: list, max_n: int, allowed_durations: Optional[set[float]] = None) -> dict:
    recent = list(assets or [])[-max_n:]
    summaries = []
    duration_inconsistencies = []

    for asset in recent:
        asset_type = asset.get("type") or asset.get("assetType") or track_id
        duration = asset.get("duration")
        start_time = asset.get("startTime")

        content = asset.get("content") or {}
        url = (
            content.get("imageUrl")
            or content.get("videoUrl")
            or content.get("audioUrl")
            or _safe_get(asset, "metadata", "resourceUrl")
        )

        generation_mode = _safe_get(asset, "metadata", "generationMode")
        last_frame_url = _safe_get(asset, "metadata", "lastFrameUrl")
        input_image_url = (
            _safe_get(asset, "metadata", "primaryImageUrl")
            or _safe_get(asset, "metadata", "inputImageUrl")
            or content.get("posterUrl")
        )
        image_urls = _safe_get(asset, "metadata", "imageUrls") or ([input_image_url] if input_image_url else [])
        audio_type = content.get("audioType") or _safe_get(asset, "metadata", "audioType")
        title = content.get("title")
        kind = _safe_get(asset, "metadata", "kind")
        text = content.get("text")
        text_preview = None
        if isinstance(text, str) and text.strip():
            text_preview = text.strip()[:160]

        summaries.append(
            {
                "id": asset.get("id"),
                "type": asset_type,
                "title": title,
                "kind": kind,
                "duration": duration,
                "startTime": start_time,
                "url": url,
                "textPreview": text_preview,
                "inputImageUrl": input_image_url,
                "imageUrls": image_urls,
                "lastFrameUrl": last_frame_url,
                "generationMode": generation_mode,
                "audioType": audio_type,
            }
        )

        if allowed_durations is not None and isinstance(duration, (int, float)):
            if float(duration) not in allowed_durations:
                duration_inconsistencies.append(
                    {"assetId": asset.get("id"), "duration": duration, "expectedOneOf": sorted(list(allowed_durations))}
                )

    return {
        "recentAssets": summaries,
        "recentCount": len(recent),
        "totalCount": len(assets or []),
        "durationInconsistencies": duration_inconsistencies,
    }


@tool(
    "analyze_timeline_state",
    description="Analyze the current canvas timeline (keyframes/videos/audio) and return a compact JSON summary for state-aware planning.",
    args_schema=AnalyzeTimelineStateInputSchema,
)
async def analyze_timeline_state(
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    max_assets_per_track: Optional[int] = 10,
) -> str:
    summary = await get_timeline_state(config=config, max_assets_per_track=max_assets_per_track)
    return "```json\n" + json.dumps(summary, ensure_ascii=False, indent=2) + "\n```"


async def get_timeline_state(config: RunnableConfig, max_assets_per_track: Optional[int] = 10) -> dict:
    ctx = config.get("configurable", {}) or {}
    canvas_id = ctx.get("canvas_id")
    session_id = ctx.get("session_id")
    user_id = ctx.get("user_id") or session_id

    if not canvas_id:
        return {"error": "canvas_id missing in RunnableConfig"}

    canvas = await api_client_service.get_canvas_data(canvas_id, user_id=user_id)
    canvas_data = (canvas or {}).get("data") or {}
    timeline = canvas_data.get("timeline") or {}
    tracks = timeline.get("tracks") or []

    track_by_id = {t.get("id"): t for t in tracks if isinstance(t, dict) and t.get("id")}
    script_track = track_by_id.get("script-track") or {}
    world_track = track_by_id.get("world-track") or {}
    keyframe_track = track_by_id.get("keyframe-track") or {}
    video_track = track_by_id.get("video-track") or {}
    audio_track = track_by_id.get("audio-track") or {}

    scripts = script_track.get("assets") or []
    worlds = world_track.get("assets") or []
    keyframes = keyframe_track.get("assets") or []
    videos = video_track.get("assets") or []
    audios = audio_track.get("assets") or []

    def _last_keyframe_url(offset_from_end: int) -> Optional[str]:
        if len(keyframes) < abs(offset_from_end):
            return None
        asset = keyframes[offset_from_end]
        return _safe_get(asset, "content", "imageUrl") or _safe_get(asset, "metadata", "resourceUrl")

    return {
        "canvasId": canvas_id,
        "canonicalMediaDurationSeconds": CANONICAL_MEDIA_DURATION_SECONDS,
        "timeline": {
            "duration": timeline.get("duration"),
            "lastUpdated": timeline.get("lastUpdated"),
            "trackIds": [t.get("id") for t in tracks if isinstance(t, dict)],
        },
        "script": {
            **_summarize_assets("script", scripts, max_assets_per_track or 10, allowed_durations=None),
            "hasAny": len(scripts) > 0,
        },
        "world": {
            **_summarize_assets("world", worlds, max_assets_per_track or 10, allowed_durations=None),
            "hasAny": len(worlds) > 0,
        },
        "keyframes": {
            **_summarize_assets("keyframe", keyframes, max_assets_per_track or 10, allowed_durations={7.5, 15.0}),
            "hasAny": len(keyframes) > 0,
            "hasTwoOrMore": len(keyframes) >= 2,
            "lastUrl": _last_keyframe_url(-1),
            "secondLastUrl": _last_keyframe_url(-2),
        },
        "videos": {
            **_summarize_assets("video", videos, max_assets_per_track or 10, allowed_durations={15.0}),
            "hasAny": len(videos) > 0,
        },
        "audio": {
            **_summarize_assets("audio", audios, max_assets_per_track or 10, allowed_durations={8.0}),
            "hasAny": len(audios) > 0,
        },
    }
