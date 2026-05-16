"""
Storyboard executor.

Deterministic execution layer for the multi-agent system:
- Writes detailed Script Track rows aligned 1:1 with 15-second clips first.
- Then generates World Track assets (characters / locations / props / style anchors).
- Generates the first clip with direct text-to-video, then continues sequentially with video-to-video using the nearest previous clips as references.
- Keyframe Track is optional and no longer the default execution path.
"""

from __future__ import annotations

import asyncio
import boto3
import json
import hashlib
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional, Annotated
import aiohttp
from botocore.config import Config as BotoConfig
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig

from services.api_client_service import api_client_service
from services.config_service import config_service
from services.websocket_service import send_session_update
from services.message_api_service import create_chat_message, fetch_session_messages
from services.video_gate_service import prepare_video_gate, wait_for_video_gate, clear_video_gate
from services.nolanx.bridges import invoke_acp_bridge
from services.nolanx.memory import mutate_memory
from services.runtime_logger import log_runtime_event, log_runtime_warning

from .timeline_utils import (
    build_review_event_from_asset,
    create_keyframe_asset,
    create_video_asset,
    create_script_asset,
    create_world_asset,
    generate_file_id,
)
from .img_generators.reelmind import ReelMindGenerator
from .img_edit_generators.reelmind import ReelMindImageEditGenerator
from .structured_output_generators import get_latest_structured_output
from .vid_generators.reelmind import ReelMindVideoGenerator
from .aspect_ratio_utils import normalize_generation_aspect_ratio

AGENT_REQUEST_NAMESPACE = uuid.UUID("2af58b64-a8f4-4c0e-9d49-7ef7f7d5b6d1")


CANONICAL_DURATION_SECONDS = 15
HALF_DURATION_SECONDS = CANONICAL_DURATION_SECONDS / 2
WORLD_TRACK_MAX_ASSETS = 50
WORLD_DURATION_TIERS_SECONDS = (8, 4, 2, 1)
WORLD_ASSET_VIDEO_GENERATION_SECONDS = 4
WORLD_ASSET_REFERENCE_DURATION_SECONDS = 4
WORLD_ASSET_VIDEO_BUDGET_SECONDS = 15
MAX_EDIT_INPUT_IMAGES = 6
MAX_FORMAL_VIDEO_REFERENCE_IMAGES = 9
MAX_PARALLEL_WORLD_GENERATIONS = 4
MAX_PARALLEL_VIDEO_GENERATIONS = 1
MAX_VIDEO_PROMPT_CHARS = 2500
MAX_VIDEO_REF_LINES = 8
MAX_VIDEO_BEAT_LINES = 8
MAX_VIDEO_DIALOGUE_LINES = 4
MAX_VIDEO_FAILURES_IN_MESSAGE = 3
VIDEO_BATCH_GATE_SECONDS = 180
MAX_VIDEO_CONTINUITY_REFS = 3
MAX_REFERENCE_VIDEO_TOTAL_SECONDS = 15
VIDEO_CONTINUITY_PROMPT_PREFIX = "Do not repeat the original video content. Continue creatively according to the script below: "
WORLD_ASSET_PROMPT_QUALITY_SUFFIX = (
    " Use clean, even exposure. Keep faces naturally lit, never underexposed, never muddy, never blacked out. "
    "Preserve visible skin detail, readable shadows, and clear subject separation."
)
MAX_FORMAL_VIDEO_INPUTS = 3
VIDEO_GENERATION_BATCH_SIZE = 1
CONTINUITY_TAIL_DURATION_SECONDS = 6
FIRST_VIDEO_GATE_TIMEOUT_SECONDS = 120
SECOND_BATCH_GATE_TIMEOUT_SECONDS = 120


def _dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _nolanx_phase_runtime_config() -> dict[str, Any]:
    cfg = config_service.get_service_config("nolanx") or {}
    return cfg.get("phase_runtimes") or {}


def _summarize_storyboard_identity_memory(storyboard: dict[str, Any], *, aspect_ratio: str) -> str:
    title = str(storyboard.get("title") or "Untitled").strip()
    style = str(storyboard.get("style") or "").strip()
    visual_bible = storyboard.get("visual_bible") or storyboard.get("visualBible") or {}
    bible = storyboard.get("bible") or storyboard.get("world") or {}
    elements = bible.get("elements") or []
    shots = storyboard.get("shots") or []

    character_lines: list[str] = []
    location_lines: list[str] = []
    prop_lines: list[str] = []
    for element in elements[:16]:
        if not isinstance(element, dict):
            continue
        element_id = str(element.get("id") or "").strip()
        kind = str(element.get("kind") or "").strip().lower()
        name = str(element.get("name") or element_id).strip()
        invariants = str(element.get("visual_invariants") or element.get("description") or "").strip()
        line = f"{element_id} {name}: {invariants}" if element_id else f"{name}: {invariants}"
        if kind == "character":
            character_lines.append(line[:320])
        elif kind == "location":
            location_lines.append(line[:320])
        else:
            prop_lines.append(line[:320])

    shot_refs: list[str] = []
    for shot in shots[:8]:
        if not isinstance(shot, dict):
            continue
        shot_index = int(shot.get("index") or 0)
        refs = [str(ref).strip() for ref in (shot.get("world_refs") or []) if str(ref).strip()]
        continuity = str(shot.get("continuity_note") or "").strip()
        if refs or continuity:
            shot_refs.append(
                f"shot {shot_index}: refs={', '.join(refs[:6]) or 'none'}; continuity={continuity[:180]}"
            )

    parts = [
        f"# Story World Identity Lock",
        f"title: {title}",
        f"aspect_ratio: {aspect_ratio}",
        f"style: {style}" if style else "",
        f"visual_style: {str(visual_bible.get('style_name') or '').strip()}" if visual_bible else "",
        "characters:",
        *(f"- {line}" for line in character_lines[:6]),
        "locations:",
        *(f"- {line}" for line in location_lines[:4]),
        "props_and_other_assets:",
        *(f"- {line}" for line in prop_lines[:6]),
        "continuity_map:",
        *(f"- {line}" for line in shot_refs[:6]),
    ]
    return "\n".join(part for part in parts if part).strip()


def _persist_storyboard_identity_memory(
    *,
    storyboard: dict[str, Any],
    user_id: str,
    aspect_ratio: str,
) -> None:
    memory_entry = _summarize_storyboard_identity_memory(storyboard, aspect_ratio=aspect_ratio)
    try:
        current_status = mutate_memory("status", "memory", None, user_id)
        current_content = str(current_status.get("content") or "")
        header = "# Story World Identity Lock"
        if header in current_content:
            old_entry = next((entry for entry in current_content.split("\n\n---\n\n") if header in entry), "")
            mutate_memory("replace", "memory", memory_entry, user_id, old_text=old_entry or header)
        else:
            mutate_memory("add", "memory", memory_entry, user_id)
        log_runtime_event("memory.storyboard_identity_persisted", user_id=user_id)
    except Exception as exc:
        log_runtime_warning("memory.storyboard_identity_persist_failed", user_id=user_id, error=str(exc))


async def _try_delegate_phase_to_acp(
    *,
    phase_name: str,
    operation_default: str,
    payload: dict[str, Any],
    session_id: str,
    canvas_id: str,
    user_id: str,
) -> Optional[dict[str, Any]]:
    phase_cfg = (_nolanx_phase_runtime_config().get(phase_name) or {})
    if not phase_cfg.get("enabled"):
        return None
    bridge_name = str(phase_cfg.get("bridge_name") or "").strip()
    operation = str(phase_cfg.get("operation") or operation_default).strip()
    if not bridge_name:
        return None
    return await invoke_acp_bridge(
        bridge_name=bridge_name,
        operation=operation,
        payload=payload,
        session_id=session_id,
        canvas_id=canvas_id,
        user_id=user_id,
    )


def _nolanx_storyboard_bridge_config() -> dict[str, Any]:
    cfg = config_service.get_service_config("nolanx") or {}
    return cfg.get("storyboard_runtime") or {}


async def _try_delegate_storyboard_to_acp(
    *,
    canvas_id: str,
    session_id: str,
    user_id: str,
    storyboard: dict[str, Any],
    storyboard_json: Optional[str],
    dry_run: bool,
    phase: str,
    resume: bool,
) -> Optional[str]:
    bridge_cfg = _nolanx_storyboard_bridge_config()
    if not bridge_cfg.get("enabled"):
        return None

    operation = str(bridge_cfg.get("operation") or "execute_storyboard").strip()
    bridge_name = str(bridge_cfg.get("bridge_name") or "").strip()
    if not bridge_name:
        return None

    payload = {
        "canvas_id": canvas_id,
        "session_id": session_id,
        "user_id": user_id,
        "storyboard_json": storyboard_json or json.dumps(storyboard, ensure_ascii=False),
        "dry_run": bool(dry_run),
        "phase": phase,
        "resume": bool(resume),
        "delegated_by": "local_storyboard_executor",
    }

    result = await invoke_acp_bridge(
        bridge_name=bridge_name,
        operation=operation,
        payload=payload,
        session_id=session_id,
        canvas_id=canvas_id,
        user_id=user_id,
    )

    remote = result.get("result") if isinstance(result, dict) else None
    if isinstance(remote, dict):
        if isinstance(remote.get("message"), str) and remote.get("message").strip():
            return remote.get("message").strip()
        if isinstance(remote.get("result"), str) and remote.get("result").strip():
            return remote.get("result").strip()
    return f"execute_storyboard delegated via ACP bridge '{bridge_name}'"


_EXECUTOR_PROGRESS_MESSAGES: dict[str, dict[str, str]] = {
    "script_track": {
        "en": "Writing Script Track rows and subshots to the timeline...",
        "zh-CN": "正在将脚本轨条目和子镜头写入时间线...",
        "ja-JP": "スクリプトトラックの行とサブショットをタイムラインに書き込んでいます...",
        "ko-KR": "스크립트 트랙 행과 서브샷을 타임라인에 기록하는 중입니다...",
    },
    "world_track": {
        "en": "Generating World Track assets with the locked visual bible...",
        "zh-CN": "正在依据锁定的视觉圣经生成世界观轨道资产...",
        "ja-JP": "固定されたビジュアルバイブルに基づいてワールドトラック資産を生成しています...",
        "ko-KR": "고정된 비주얼 바이블로 월드 트랙 자산을 생성하는 중입니다...",
    },
    "keyframes": {
        "en": "",
        "zh-CN": "",
        "ja-JP": "",
        "ko-KR": "",
    },
    "video_start": {
        "en": "Generating {count} video clips sequentially with timeline continuity...",
        "zh-CN": "正在按时间线连续性顺序生成 {count} 个视频片段...",
        "ja-JP": "タイムラインの連続性を保ちながら {count} 本の動画クリップを順番に生成しています...",
        "ko-KR": "타임라인 연속성을 유지하면서 {count}개의 비디오 클립을 순차 생성하는 중입니다...",
    },
    "video_progress": {
        "en": "Video generation progressing: {done}/{total} clips committed to the timeline...",
        "zh-CN": "视频生成进度：{done}/{total} 个片段已写入时间线...",
        "ja-JP": "動画生成の進行状況: {done}/{total} 本のクリップをタイムラインへ反映しました...",
        "ko-KR": "비디오 생성 진행 중: {done}/{total}개 클립이 타임라인에 반영되었습니다...",
    },
    "finalize": {
        "en": "Finalizing storyboard execution and syncing planner state...",
        "zh-CN": "正在收尾分镜执行流程并同步规划状态...",
        "ja-JP": "ストーリーボード実行を仕上げ、プランナー状態を同期しています...",
        "ko-KR": "스토리보드 실행을 마무리하고 플래너 상태를 동기화하는 중입니다...",
    },
    "complete": {
        "en": "",
        "zh-CN": "",
        "ja-JP": "",
        "ko-KR": "",
    },
}


def _normalize_executor_locale(preferred_language: str | None) -> str:
    locale = str(preferred_language or "").strip()
    if locale in _EXECUTOR_PROGRESS_MESSAGES["script_track"]:
        return locale
    if locale.startswith("zh"):
        return "zh-CN"
    if locale.startswith("ja"):
        return "ja-JP"
    if locale.startswith("ko"):
        return "ko-KR"
    return "en"


def _executor_progress_message(key: str, preferred_language: str | None, **values: Any) -> str:
    locale = _normalize_executor_locale(preferred_language)
    template = (
        _EXECUTOR_PROGRESS_MESSAGES.get(key, {}).get(locale)
        or _EXECUTOR_PROGRESS_MESSAGES.get(key, {}).get("en")
        or key
    )
    safe_values = {k: str(v) for k, v in values.items()}
    return template.format(**safe_values)


def _select_continuity_reference_videos(
    clip_index: int,
    available_video_urls_by_clip: dict[int, str],
    clip_duration_seconds: int,
) -> list[str]:
    selected: list[str] = []
    accumulated_seconds = 0

    for idx in range(clip_index - 1, max(0, clip_index - MAX_VIDEO_CONTINUITY_REFS) - 1, -1):
        candidate = available_video_urls_by_clip.get(idx)
        if not candidate:
            continue
        if accumulated_seconds + clip_duration_seconds > MAX_REFERENCE_VIDEO_TOTAL_SECONDS:
            continue
        selected.append(candidate)
        accumulated_seconds += clip_duration_seconds

    selected.reverse()
    return selected


def _world_track_duration_for_element(*, element: dict, rank: int, max_importance: float) -> float:
    """
    Allocate World Track cell duration (in seconds) from {8,4,2,1}.

    Design goals:
    - Allow multiple 8s/4s/2s/1s (not a single hard-coded sequence).
    - Ensure top-ranked key elements stay visible longer.
    - Keep style/mood anchors readable even if their importance is slightly lower.
    """
    try:
        importance = float(element.get("importance") or 0)
    except Exception:
        importance = 0.0

    element_id = str(element.get("id") or "").strip().upper()
    kind = str(element.get("kind") or "").strip().lower()

    # Baseline tiering by rank buckets (ensures we can have MANY 8/4/2/1 items; not just a single fixed sequence).
    # Typical distribution for up to 50 assets:
    # - top 3: 8s (main cast / primary world anchors)
    # - next 12: 4s (supporting cast / key locations / recurring props)
    # - next 20: 2s (additional supporting elements)
    # - rest: 1s
    if rank < 3:
        tier = 8
    elif rank < 15:
        tier = 4
    elif rank < 35:
        tier = 2
    else:
        tier = 1

    # Upgrade tier based on normalized importance (if importance values are meaningful).
    if max_importance > 0:
        ratio = max(0.0, min(1.0, importance / max_importance))
        if ratio >= 0.8:
            tier = max(tier, 8)
        elif ratio >= 0.6:
            tier = max(tier, 4)
        elif ratio >= 0.4:
            tier = max(tier, 2)

    # Style/mood boards are global anchors; don't let them fall to 1s.
    if (
        element_id.startswith(("STYLE", "MOOD", "LOOK", "PALETTE", "ART"))
        or "style" in kind
        or "mood" in kind
    ):
        tier = max(tier, 4)

    if tier not in WORLD_DURATION_TIERS_SECONDS:
        tier = 1
    return float(tier)


def _element_is_character(element: dict) -> bool:
    element_id = str(element.get("id") or "").strip().upper()
    kind = str(element.get("kind") or "").strip().lower()
    return (
        kind == "character"
        or "character" in kind
        or element_id.startswith("CHR")
        or _looks_like_character_code(element_id)
    )


def _element_is_location(element: dict) -> bool:
    element_id = str(element.get("id") or "").strip().upper()
    kind = str(element.get("kind") or "").strip().lower()
    return (
        kind == "location"
        or "location" in kind
        or "scene" in kind
        or "environment" in kind
        or element_id.startswith("LOC")
    )


def _element_is_prop_like(element: dict) -> bool:
    element_id = str(element.get("id") or "").strip().upper()
    kind = str(element.get("kind") or "").strip().lower()
    return (
        kind == "prop"
        or "prop" in kind
        or "object" in kind
        or "vehicle" in kind
        or "costume" in kind
        or "creature" in kind
        or element_id.startswith(("PROP", "OBJ", "VEH", "COST", "CRE"))
    )


def _element_supports_world_video(element: dict) -> bool:
    return _element_is_character(element) or _element_is_location(element) or _element_is_prop_like(element)


def _world_video_reference_kind_label(element: dict) -> str:
    if _element_is_character(element):
        return "演员试镜视频"
    if _element_is_location(element):
        return "场景环绕视频"
    if _element_is_prop_like(element):
        return "道具环绕视频"
    return "世界参考视频"


def _is_audio_safety_block_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return (
        "output audio may contain sensitive information" in message
        or "byteplus_task_failed" in message
        or "sensitive information" in message
    )


def _build_world_asset_video_prompt(
    element: dict,
    base_prompt: str,
    *,
    allow_dialogue_audition: bool = True,
) -> str:
    base = str(base_prompt or "").strip()
    name = str(element.get("name") or element.get("id") or "world asset").strip()
    description = str(element.get("description") or "").strip()
    voice_profile = element.get("voice_profile") if isinstance(element.get("voice_profile"), dict) else {}
    reference_line = str(voice_profile.get("reference_line") or "").strip()
    speaking_style = str(voice_profile.get("speaking_style") or "").strip()
    emotional_tone = str(element.get("emotional_default") or "").strip()

    if _element_is_character(element):
        if allow_dialogue_audition:
            prefix = (
                f"{name} character audition video. "
                "Single performer only. "
                f"Create a brief {WORLD_ASSET_VIDEO_GENERATION_SECONDS}-second acting audition that shows face, silhouette, costume, body language, and emotional micro-expression clearly. "
                "The performer must spend the full 4 seconds continuously delivering one consistent line of dialogue on camera with clear lip sync, uninterrupted mouth motion, and a readable expression arc from start to finish. "
                "Use a medium-close audition framing and let the face carry the performance. "
                "Keep stable identity, clean readable motion, no scene cuts, no extra characters, and no turntable presentation."
            )
        else:
            prefix = (
                f"{name} character silent acting audition video. "
                "Single performer only. "
                f"Create a brief {WORLD_ASSET_VIDEO_GENERATION_SECONDS}-second silent acting audition that shows face, silhouette, costume, body language, emotional micro-expression, and readable performance intent clearly. "
                "No spoken dialogue, no audible speech, no subtitles, and no text overlays. "
                "Use a medium-close audition framing and let the face carry the performance through expression, breath, and physical acting only. "
                "Keep stable identity, clean readable motion, no scene cuts, no extra characters, and no turntable presentation."
            )
    elif _element_is_location(element):
        prefix = (
            f"{name} environment orbit reference video. "
            f"Create a brief {WORLD_ASSET_VIDEO_GENERATION_SECONDS}-second 360 orbit showcase of the location. "
            "No humans. Preserve layout, materials, lighting mood, and spatial depth. Smooth camera orbit only, no scene cuts."
        )
    else:
        prefix = (
            f"{name} prop orbit reference video. "
            f"Create a brief {WORLD_ASSET_VIDEO_GENERATION_SECONDS}-second 360 turntable/orbit showcase of the prop or object. "
            "Single hero object only, stable identity, clean readable silhouette, material detail, no extra objects, no humans, no scene cuts."
        )

    if description:
        prefix += f" Description: {description}."
    if _element_is_character(element) and allow_dialogue_audition and reference_line:
        prefix += f" Dialogue line: \"{reference_line}\". Keep this exact line for the entire 4-second audition."
    if _element_is_character(element) and speaking_style:
        prefix += f" Delivery: {speaking_style}."
    if _element_is_character(element) and emotional_tone:
        prefix += f" Emotional continuity: {emotional_tone}."
    if base:
        prefix += f" Locked design: {base}"
    return (prefix.strip() + WORLD_ASSET_PROMPT_QUALITY_SUFFIX).strip()


def _build_world_asset_image_prompt(element: dict, base_prompt: str) -> str:
    base = str(base_prompt or "").strip()
    name = str(element.get("name") or element.get("id") or "world asset").strip()
    description = str(element.get("description") or "").strip()
    kind = str(element.get("kind") or "").strip().lower()
    visual_invariants = element.get("visual_invariants")
    invariant_text = (
        ", ".join(str(item).strip() for item in visual_invariants if str(item).strip())
        if isinstance(visual_invariants, list)
        else str(visual_invariants or "").strip()
    )
    kind_instruction = "single world asset"
    if _element_is_character(element):
        kind_instruction = "single recurring character"
    elif _element_is_location(element):
        kind_instruction = "single environment/location with no people, silhouettes, body parts, or faces"
    elif kind:
        kind_instruction = f"single {kind} world asset"

    parts = [
        f"{name} World Track reference board for downstream audition and formal video generation.",
        "Generate exactly one complete 3x3 nine-panel cinematic storyboard contact sheet in a single image.",
        f"The board must depict the same locked {kind_instruction} across all nine panels.",
        "Keep character identity, costume, environment, lighting direction, color palette, weather, materials, textures, and overall film style perfectly consistent.",
        "Only change action, expression, camera position, composition, and depth of field.",
        "Do not add any new characters, creatures, props, architecture, vehicles, or objects that are not already implied by the locked design.",
        "If this is a location asset, the entire board must be empty of people, silhouettes, body parts, faces, or human reflections.",
        "If this is a prop asset, the entire board must be a pure object study with no people, no hands, no faces, no silhouettes, and no human reflections.",
        "Follow real photographic logic, realistic physical lighting, cinematic contrast, subtle film texture, and emotional progression.",
        "Reference analysis rules: preserve subject position/orientation/posture/action logic, preserve foreground/midground/background relationships, preserve light direction/quality/shadows/contrast/time-of-day mood, preserve unified visual anchors such as palette, props, texture, weather, and material response.",
        "Emotion arc across the grid: setup, escalation, turn, release.",
        "Depth-of-field logic must stay realistic: wide shots use deep depth of field, medium shots use medium depth of field, close-ups use shallow depth of field.",
        "Panel order is mandatory: panel 1 establishing wide with full subject/environment relation; panel 2 medium-wide with slight action; panel 3 medium emotional observation; panel 4 medium variation with action escalation; panel 5 medium-close with atmosphere intensifying; panel 6 close-up emotional peak; panel 7 extreme close-up of prop/detail; panel 8 expressive high-angle or low-angle shot; panel 9 wide or half-body closing resolution shot.",
        "The whole board must read as one continuous western cinematic sequence with consistent grading and continuity.",
        "No text labels, no subtitles, no infographic layout chrome, no extra borders beyond the clean 3x3 panel structure.",
    ]
    if description:
        parts.append(f"Description: {description}.")
    if invariant_text:
        parts.append(f"Visual invariants: {invariant_text}.")
    if base:
        parts.append(f"Locked design prompt: {base}")
    prompt = " ".join(part.strip() for part in parts if part).strip()
    return (prompt + WORLD_ASSET_PROMPT_QUALITY_SUFFIX).strip()


def _select_world_reference_videos_for_shot(
    refs: list[str],
    primary_ref: Optional[str],
    world_map: dict[str, dict],
    world_video_refs_by_id: dict[str, dict[str, Any]],
    max_total_seconds: float = WORLD_ASSET_VIDEO_BUDGET_SECONDS,
    max_videos: int = MAX_FORMAL_VIDEO_INPUTS,
) -> list[dict[str, Any]]:
    ordered_refs: list[str] = []
    if isinstance(primary_ref, str) and primary_ref.strip():
        ordered_refs.append(primary_ref.strip())
    ordered_refs.extend([str(ref).strip() for ref in refs if isinstance(ref, str) and str(ref).strip()])

    selected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    accumulated = 0.0

    for element_id in ordered_refs:
        if element_id in seen_ids:
            continue
        seen_ids.add(element_id)
        element = world_map.get(element_id) or {}
        if not _element_supports_world_video(element):
            continue
        candidate = world_video_refs_by_id.get(element_id)
        if not candidate:
            continue
        duration_seconds = float(candidate.get("duration_seconds") or WORLD_ASSET_REFERENCE_DURATION_SECONDS)
        if accumulated + duration_seconds > max_total_seconds:
            continue
        selected.append(candidate)
        accumulated += duration_seconds
        if len(selected) >= max_videos:
            break

    return selected


def _select_world_reference_image_urls_for_shot(
    refs: list[str],
    primary_ref: Optional[str],
    world_images_by_id: dict[str, str],
    max_images: int = MAX_FORMAL_VIDEO_REFERENCE_IMAGES,
) -> list[str]:
    ordered_refs: list[str] = []
    if isinstance(primary_ref, str) and primary_ref.strip():
        ordered_refs.append(primary_ref.strip())
    ordered_refs.extend([str(ref).strip() for ref in refs if isinstance(ref, str) and str(ref).strip()])

    selected: list[str] = []
    seen_refs: set[str] = set()
    seen_urls: set[str] = set()
    for element_id in ordered_refs:
        if element_id in seen_refs:
            continue
        seen_refs.add(element_id)
        url = str(world_images_by_id.get(element_id) or "").strip()
        if not url or url in seen_urls:
            continue
        selected.append(url)
        seen_urls.add(url)
        if len(selected) >= max_images:
            break
    return selected


def _required_world_video_ref_ids_for_shot(
    refs: list[str],
    primary_ref: Optional[str],
    world_map: dict[str, dict],
) -> list[str]:
    ordered_refs: list[str] = []
    if isinstance(primary_ref, str) and primary_ref.strip():
        ordered_refs.append(primary_ref.strip())
    ordered_refs.extend([str(ref).strip() for ref in refs if isinstance(ref, str) and str(ref).strip()])

    required: list[str] = []
    seen: set[str] = set()
    for element_id in ordered_refs:
        if element_id in seen:
            continue
        seen.add(element_id)
        element = world_map.get(element_id) or {}
        if _element_supports_world_video(element):
            required.append(element_id)
    return required


def _score_prior_clip_for_continuity(
    *,
    clip_index: int,
    candidate_clip_index: int,
    primary_world_ref: Optional[str],
    raw_world_refs: list[str],
    shot: dict[str, Any],
    clip_context_by_index: dict[int, dict[str, Any]],
) -> int:
    current_ref_set = {
        value
        for value in ([primary_world_ref] if primary_world_ref else []) + raw_world_refs
        if isinstance(value, str) and value
    }
    current_character_refs = {ref_id for ref_id in current_ref_set if ref_id.upper().startswith("CHR")}
    shot_text = " ".join(
        str(shot.get(key) or "")
        for key in ("shot_description", "character_action", "dialogue", "voice_direction", "camera_language")
    ).lower()
    continuity_keywords = ("continue", "same", "still", "again", "ongoing", "follows", "reaction", "conversation")
    prefer_continuity = len(current_character_refs) >= 2 or any(keyword in shot_text for keyword in continuity_keywords)

    candidate_context = clip_context_by_index.get(candidate_clip_index) or {}
    candidate_ref_set = set(candidate_context.get("world_refs") or [])
    overlap_score = len(current_ref_set & candidate_ref_set)
    if primary_world_ref and candidate_context.get("primary_world_ref") == primary_world_ref:
        overlap_score += 3
    if overlap_score <= 0 and candidate_clip_index != clip_index - 1:
        return -1
    recency_score = max(0, 10 - (clip_index - candidate_clip_index))
    adjacency_bonus = 4 if candidate_clip_index == clip_index - 1 else 0
    continuity_bonus = 3 if prefer_continuity else 0
    return overlap_score * 10 + recency_score + adjacency_bonus + continuity_bonus


def _select_preferred_continuity_reference_video(
    *,
    clip_index: int,
    shot_index: int,
    shot: dict[str, Any],
    primary_world_ref: Optional[str],
    raw_world_refs: list[str],
    available_continuity_tail_refs_by_clip: dict[int, dict[str, Any]],
    available_video_urls_by_clip: dict[int, str],
    clip_context_by_index: dict[int, dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if clip_index <= 1:
        return None

    immediate_previous_tail = available_continuity_tail_refs_by_clip.get(clip_index - 1)
    if isinstance(immediate_previous_tail, dict):
        preferred_video_url = str(immediate_previous_tail.get("preferred_video_url") or "").strip()
        if preferred_video_url:
            return immediate_previous_tail

    candidate_clip_indexes = sorted(
        {
            *[idx for idx in available_continuity_tail_refs_by_clip.keys() if idx < clip_index],
            *[idx for idx in available_video_urls_by_clip.keys() if idx < clip_index],
        },
        reverse=True,
    )

    best_clip_index: Optional[int] = None
    best_score = -1
    best_prefers_tail = False
    for candidate_clip_index in candidate_clip_indexes:
        score = _score_prior_clip_for_continuity(
            clip_index=clip_index,
            candidate_clip_index=candidate_clip_index,
            primary_world_ref=primary_world_ref,
            raw_world_refs=raw_world_refs,
            shot=shot,
            clip_context_by_index=clip_context_by_index,
        )
        if score < 0:
            continue
        has_tail = candidate_clip_index in available_continuity_tail_refs_by_clip
        if has_tail:
            score += 5
        if score > best_score or (score == best_score and has_tail and not best_prefers_tail):
            best_score = score
            best_clip_index = candidate_clip_index
            best_prefers_tail = has_tail

    if best_clip_index is None:
        return None

    preferred_tail = available_continuity_tail_refs_by_clip.get(best_clip_index)
    if isinstance(preferred_tail, dict):
        preferred_video_url = str(preferred_tail.get("preferred_video_url") or "").strip()
        if preferred_video_url:
            return preferred_tail

    continuity_url = str(available_video_urls_by_clip.get(best_clip_index) or "").strip()
    if continuity_url:
        return {
            "source_clip_index": best_clip_index,
            "preferred_video_url": continuity_url,
            "public_video_url": continuity_url,
            "duration_seconds": float(CANONICAL_DURATION_SECONDS),
            "source_type": "full_clip_fallback",
            "reference_kind": "正式视频续接参考",
            "name": f"Clip {best_clip_index} full clip",
            "poster_url": continuity_url,
        }

    return None


def _build_ordered_reference_prompt_block(
    *,
    video_urls: list[str],
    image_urls: list[str],
    video_refs: list[dict[str, Any]],
    world_refs: list[str],
    primary_world_ref: Optional[str],
    world_map: dict[str, dict],
    continuity_ref: Optional[dict[str, Any]],
) -> str:
    lines: list[str] = [
        "Use the ordered @video N and @image N references directly as continuity anchors.",
        "Keep the image bright, readable, and clean: preserve faces, skin tones, costumes, props, and midtones; avoid crushed blacks, muddy shadows, and uniformly dark frames.",
    ]
    continuity_source_type = str((continuity_ref or {}).get("source_type") or "")
    continuity_duration = float((continuity_ref or {}).get("duration_seconds") or 0.0) if isinstance(continuity_ref, dict) else 0.0
    for idx, url in enumerate(video_urls, start=1):
        matched_ref = next(
            (ref for ref in video_refs if str(ref.get("preferred_video_url") or "").strip() == url),
            None,
        )
        name = str((matched_ref or {}).get("name") or (continuity_ref or {}).get("name") or f"video reference {idx}")
        kind = str((matched_ref or {}).get("reference_kind") or (continuity_ref or {}).get("reference_kind") or "video reference")
        lines.append(f"@video {idx}: {name} / {kind}.")
    if video_urls and continuity_source_type == "tail":
        lines.append(f"Continue from the final {continuity_duration:.1f}s tail of @video 1 without repeating or restarting it.")
    elif video_urls:
        lines.append("Continue from @video 1 without repeating its content.")

    ordered_world_refs: list[str] = []
    if isinstance(primary_world_ref, str) and primary_world_ref.strip():
        ordered_world_refs.append(primary_world_ref.strip())
    ordered_world_refs.extend([ref for ref in world_refs if isinstance(ref, str) and ref.strip()])
    deduped_world_refs = _dedupe_keep_order(ordered_world_refs)
    for idx, _url in enumerate(image_urls, start=1):
        element_id = deduped_world_refs[idx - 1] if idx - 1 < len(deduped_world_refs) else ""
        element = world_map.get(element_id) or {}
        name = str(element.get("name") or element_id or f"image reference {idx}")
        kind = str(element.get("kind") or "world asset")
        lines.append(f"@image {idx}: {name} / {kind}.")
    if image_urls:
        lines.append("Use @image references as current-scene design locks.")
    return " ".join(lines).strip()


def _probe_video_duration_seconds(file_path: str) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr.strip() or result.stdout.strip()}")
    duration_text = str(result.stdout or "").strip()
    duration = float(duration_text)
    if duration <= 0:
        raise RuntimeError(f"invalid video duration: {duration_text}")
    return duration


def _extract_video_tail_clip(input_path: str, output_path: str, *, tail_seconds: float) -> float:
    source_duration = _probe_video_duration_seconds(input_path)
    actual_tail_seconds = max(0.5, min(float(tail_seconds), source_duration))
    start_seconds = max(0.0, source_duration - actual_tail_seconds)
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        input_path,
        "-t",
        f"{actual_tail_seconds:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg tail extraction failed: {result.stderr.strip() or result.stdout.strip()}")
    return actual_tail_seconds


async def _download_remote_video_to_file(video_url: str, output_path: str) -> None:
    timeout = aiohttp.ClientTimeout(total=180)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(video_url) as response:
            if response.status >= 400:
                error_text = await response.text()
                raise RuntimeError(f"video download failed with status {response.status}: {error_text}")
            with open(output_path, "wb") as fh:
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    fh.write(chunk)


async def _download_remote_video_with_fallback(url_candidates: list[str], output_path: str) -> str:
    attempts: list[str] = []
    last_error: Optional[Exception] = None
    for candidate in url_candidates:
        normalized = str(candidate or "").strip()
        if not normalized or normalized in attempts:
            continue
        attempts.append(normalized)
        try:
            await _download_remote_video_to_file(normalized, output_path)
            return normalized
        except Exception as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise RuntimeError("no valid downloadable video urls were provided")


async def _upload_local_video_to_r2(local_file_path: str, *, filename: str, user_id: str | None = None) -> tuple[str, str]:
    mime_type = mimetypes.guess_type(filename)[0] or "video/mp4"
    r2_config = config_service.get_service_config('r2_storage') or {}
    account_id = str(r2_config.get('account_id') or "").strip()
    access_key_id = str(r2_config.get('access_key_id') or "").strip()
    secret_access_key = str(r2_config.get('secret_access_key') or "").strip()
    bucket_name = str(r2_config.get('bucket_name') or "").strip()
    public_url_base = str(r2_config.get('public_url') or "").rstrip("/")
    if not all([account_id, access_key_id, secret_access_key, bucket_name, public_url_base]):
        raise RuntimeError("r2_storage config is incomplete")

    file_id = generate_file_id()
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", filename).strip("-") or f"{file_id}.mp4"
    if user_id:
        object_key = f"gen_video_task/user_{user_id}/continuity_tail_{file_id}_{safe_name}"
    else:
        object_key = f"gen_video_task/continuity_tail_{file_id}_{safe_name}"

    r2_client = boto3.client(
        's3',
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=BotoConfig(region_name='auto', retries={'max_attempts': 3}),
    )

    with open(local_file_path, 'rb') as file_obj:
        r2_client.upload_fileobj(
            file_obj,
            bucket_name,
            object_key,
            ExtraArgs={
                'ContentType': mime_type,
                'ACL': 'public-read',
            },
        )

    public_url = f"{public_url_base}/{object_key}"
    return mime_type, public_url


def _primary_user_character_element_id(elements: list[dict]) -> Optional[str]:
    character_elements = [el for el in elements if isinstance(el, dict) and _element_is_character(el)]
    if not character_elements:
        return None

    def _score(el: dict) -> tuple[float, int]:
        try:
            importance = float(el.get("importance") or 0)
        except Exception:
            importance = 0.0
        linked = el.get("linked_shot_indexes") or []
        linked_count = len(linked) if isinstance(linked, list) else 0
        return (importance, linked_count)

    ranked = sorted(character_elements, key=_score, reverse=True)
    top = ranked[0]
    element_id = str(top.get("id") or "").strip()
    return element_id or None


def _self_insert_world_prompt(prompt: str) -> str:
    base = str(prompt or "").strip()
    prefix = (
        "Derive this character from the uploaded user identity reference images. "
        "Preserve facial identity, hair, age impression, body proportions, and core recognizable features while adapting wardrobe, pose, camera setup, and scene styling to the storyboard. "
        "Do not invent a different person."
    )
    if not base:
        return prefix
    return f"{prefix} {base}"


class ExecuteStoryboardInputSchema(BaseModel):
    storyboard_json: Optional[str] = Field(
        default=None,
        description=(
            "Storyboard JSON string (as produced by generate_structured_output). "
            "If omitted, the tool will try to extract the last JSON block from conversation history."
        ),
    )
    dry_run: Optional[bool] = Field(default=False, description="If true, only returns the computed plan; no generation.")
    phase: Optional[str] = Field(
        default="all",
        description="Execution phase: 'all' (default: world assets + script assets + videos), 'keyframes' (only generate keyframes), or 'videos' (only generate videos).",
    )
    resume: Optional[bool] = Field(
        default=True,
        description="If true, reuse existing storyboard-tagged keyframes/videos on the canvas timeline instead of regenerating duplicates.",
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


def _extract_json_blocks(text: str) -> list[str]:
    if not isinstance(text, str):
        return []
    cleaned = text.strip()
    # Prefer the explicit marker used by our structured output tool.
    if "**Structured Output:**" in cleaned:
        cleaned = cleaned.split("**Structured Output:**", 1)[1].strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    blocks = re.findall(r"(\{.*\}|\[.*\])", cleaned, flags=re.DOTALL)
    return [b.strip() for b in blocks]


def _load_storyboard_from_messages(messages: list[dict]) -> Optional[dict]:
    for m in reversed(messages or []):
        if not isinstance(m, dict):
            continue
        snapshot = _load_resume_state_from_message(m)
        if isinstance(snapshot, dict):
            embedded_storyboard = snapshot.get("storyboard")
            if isinstance(embedded_storyboard, dict) and isinstance(embedded_storyboard.get("shots"), list):
                return embedded_storyboard
            resume_args = snapshot.get("resumeArgs")
            storyboard_text = resume_args.get("storyboard_json") if isinstance(resume_args, dict) else None
            if isinstance(storyboard_text, str) and storyboard_text.strip():
                try:
                    parsed = json.loads(storyboard_text)
                    if isinstance(parsed, dict) and isinstance(parsed.get("shots"), list):
                        return parsed
                except Exception:
                    pass
        content = m.get("content")
        if not isinstance(content, str):
            continue
        blocks = _extract_json_blocks(content)
        if not blocks:
            continue
        # Take the last block in that message.
        try:
            parsed = json.loads(blocks[-1])
            if isinstance(parsed, dict) and isinstance(parsed.get("shots"), list):
                return parsed
        except Exception:
            continue
    return None


def _load_resume_state_from_message(message: dict) -> Optional[dict]:
    if not isinstance(message, dict):
        return None
    metadata = message.get("metadata")
    if isinstance(metadata, dict):
        snapshot = metadata.get("storyboard_resume_state")
        if isinstance(snapshot, dict) and snapshot.get("type") == "storyboard_resume_state":
            return dict(snapshot)
    content = message.get("content")
    if isinstance(content, dict):
        metadata = content.get("metadata")
        if isinstance(metadata, dict):
            snapshot = metadata.get("storyboard_resume_state")
            if isinstance(snapshot, dict) and snapshot.get("type") == "storyboard_resume_state":
                return dict(snapshot)
    return None


def _load_latest_resume_state_from_messages(messages: list[dict]) -> Optional[dict]:
    for message in reversed(messages or []):
        snapshot = _load_resume_state_from_message(message)
        if snapshot:
            return snapshot
    return None


def _norm_mode(mode: Optional[str]) -> str:
    m = (mode or "").strip().lower()
    if m in {"first_last_frame", "first-last-frame", "flf"}:
        return "first_last_frame"
    return "image_to_video"


def _norm_method(method: Optional[str]) -> str:
    m = (method or "").strip().lower()
    if m in {"skip", "none"}:
        return "skip"
    if m in {"edit_image", "edit"}:
        return "edit_image"
    return "generate_image"


def _extract_world_elements(storyboard: dict) -> list[dict]:
    if not isinstance(storyboard, dict):
        return []
    world = storyboard.get("world") or storyboard.get("bible") or {}
    if not isinstance(world, dict):
        return []
    raw_elements = world.get("elements") or []
    if not isinstance(raw_elements, list):
        return []
    return [e for e in raw_elements if isinstance(e, dict)]


def _element_importance(el: dict) -> float:
    try:
        return float(el.get("importance") or 0)
    except Exception:
        return 0.0


def _looks_like_character_code(code: str) -> bool:
    c = (code or "").strip().upper()
    return bool(re.match(r"^(M|F|C|P)\d+$", c))


def _world_codes_with_images(elements: list[dict], max_count: int) -> list[str]:
    sorted_elements = sorted(elements, key=_element_importance, reverse=True)
    chosen: list[str] = []
    for el in sorted_elements:
        if len(chosen) >= max_count:
            break
        code = str(el.get("id") or "").strip()
        if not code:
            continue
        prompt = str(el.get("image_prompt_en") or "").strip()
        if not prompt:
            continue
        chosen.append(code)
    return chosen


def _normalize_world_refs_for_storyboard(storyboard: dict) -> dict[str, Any]:
    elements = _extract_world_elements(storyboard)
    known_codes = {str(e.get("id") or "").strip() for e in elements if str(e.get("id") or "").strip()}
    image_codes = _world_codes_with_images(elements, max_count=min(len(elements), WORLD_TRACK_MAX_ASSETS))
    image_code_set = set(image_codes)

    # Stable fallback anchor:
    # - prefer a style/mood anchor (works for any scene),
    # - else prefer a character sheet,
    # - else the top image code.
    style_anchor = next(
        (c for c in image_codes if c.strip().upper().startswith(("STYLE", "MOOD", "LOOK", "ART", "PALETTE"))),
        None,
    )
    character_anchor = next((c for c in image_codes if _looks_like_character_code(c)), None)
    fallback_anchor = style_anchor or character_anchor or (
        image_codes[0] if image_codes else None
    )

    def _normalize_refs(raw: Any) -> list[str]:
        refs: list[str] = []
        if isinstance(raw, list):
            for r in raw:
                if isinstance(r, str) and r.strip():
                    refs.append(r.strip())

        # Ensure we always carry at least the primary consistency anchors when available.
        if image_code_set:
            if style_anchor and style_anchor in image_code_set and style_anchor not in refs:
                refs.insert(0, style_anchor)
            if character_anchor and character_anchor in image_code_set and character_anchor not in refs:
                refs.insert(0, character_anchor)

        # Ensure we always have at least one usable image anchor so edit_image can actually work.
        if image_code_set:
            has_anchor = any(r in image_code_set for r in refs)
            if not has_anchor and fallback_anchor:
                refs.insert(0, fallback_anchor)

        # Put a preferred anchor FIRST:
        # - try an in-shot character anchor
        # - else any in-shot image anchor
        # - else fallback
        preferred = None
        for r in refs:
            if r in image_code_set and _looks_like_character_code(r):
                preferred = r
                break
        if not preferred:
            preferred = next((r for r in refs if r in image_code_set), None) or fallback_anchor
        if preferred:
            refs = [preferred] + [r for r in refs if r != preferred]
        return refs

    def _refs_from_shot_fields(shot: dict) -> list[str]:
        refs: list[str] = []
        for key in ("world_refs", "worldRefs", "asset_bindings"):
            raw = shot.get(key)
            if isinstance(raw, list):
                for r in raw:
                    if isinstance(r, str) and r.strip():
                        refs.append(r.strip())

        for slot_key in ("characters", "locations", "props", "reference_assets"):
            raw = shot.get(slot_key)
            if isinstance(raw, list):
                for item in raw:
                    if not isinstance(item, dict):
                        continue
                    code = item.get("code") or item.get("id") or item.get("world_ref")
                    if isinstance(code, str) and code.strip():
                        refs.append(code.strip())

        primary = shot.get("video_primary_world_ref")
        if isinstance(primary, str) and primary.strip():
            refs.insert(0, primary.strip())
        return refs

    normalized_shots = 0
    shots = storyboard.get("shots") or []
    if isinstance(shots, list):
        for shot in shots:
            if not isinstance(shot, dict):
                continue
            refs = _refs_from_shot_fields(shot)
            shot["world_refs"] = _normalize_refs(refs)
            if shot["world_refs"] and not shot.get("video_primary_world_ref"):
                shot["video_primary_world_ref"] = shot["world_refs"][0]
            normalized_shots += 1

    normalized_segments = 0
    segments = storyboard.get("script_segments") or storyboard.get("scriptSegments") or []
    if isinstance(segments, list):
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            refs = seg.get("world_refs") or seg.get("worldRefs") or []
            seg["world_refs"] = _normalize_refs(refs)
            normalized_segments += 1

    return {
        "knownCodes": len(known_codes),
        "imageAnchorCodes": image_codes,
        "normalizedShots": normalized_shots,
        "normalizedScriptSegments": normalized_segments,
    }


def _extract_shot_world_refs(shot: dict) -> list[str]:
    refs: list[str] = []
    for key in ("world_refs", "worldRefs", "asset_bindings"):
        raw = shot.get(key)
        if isinstance(raw, list):
            for r in raw:
                if isinstance(r, str) and r.strip():
                    refs.append(r.strip())
    for slot_key in ("characters", "locations", "props", "reference_assets"):
        raw = shot.get(slot_key)
        if isinstance(raw, list):
            for item in raw:
                if not isinstance(item, dict):
                    continue
                code = item.get("code") or item.get("id") or item.get("world_ref")
                if isinstance(code, str) and code.strip():
                    refs.append(code.strip())
    primary = shot.get("video_primary_world_ref")
    if isinstance(primary, str) and primary.strip():
        refs.insert(0, primary.strip())

    return _dedupe_keep_order(refs)


def _world_elements_by_id(storyboard: dict) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for element in _extract_world_elements(storyboard):
        element_id = str(element.get("id") or "").strip()
        if element_id:
            result[element_id] = element
    return result


def _compose_locked_video_prompt(
    shot: dict,
    world_map: dict[str, dict],
    refs: list[str],
    base_prompt: str,
    selected_world_video_refs: Optional[list[dict[str, Any]]] = None,
    visual_bible: Optional[dict[str, Any]] = None,
    global_audio: Optional[dict[str, Any]] = None,
    prev_shot: Optional[dict[str, Any]] = None,
    next_shot: Optional[dict[str, Any]] = None,
) -> str:
    def _compact_text(value: Any, limit: int) -> str:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if len(text) <= limit:
            return text
        return text[: max(0, limit - 3)].rstrip() + "..."

    binding_lock = str(shot.get("binding_lock") or f"SHOT_{int(shot.get('index') or 0):03d}_LOCK")
    shot_description = _compact_text(shot.get("shot_description"), 260)
    shot_size = _compact_text(shot.get("shot_size"), 80)
    character_action = _compact_text(shot.get("character_action"), 180)
    emotion = _compact_text(shot.get("emotion"), 100)
    lighting_mood = _compact_text(shot.get("lighting_mood"), 160)
    aesthetic_notes = _compact_text(shot.get("aesthetic_notes"), 160)
    composition_notes = _compact_text(shot.get("composition_notes"), 140)
    camera_language = _compact_text(shot.get("camera_language"), 140)
    palette_notes = _compact_text(shot.get("palette_notes"), 120)
    continuity_note = _compact_text(shot.get("continuity_note"), 180)
    dialogue = _compact_text(shot.get("dialogue"), 120)
    voice_direction = _compact_text(shot.get("voice_direction"), 120)
    sound_effects = _compact_text(shot.get("sound_effects"), 120)
    dialogue_lines = shot.get("dialogue_lines") or []
    global_audio = global_audio or {}
    global_music_prompt = _compact_text(global_audio.get("music_prompt_en"), 90)
    global_sfx_prompt = _compact_text(global_audio.get("sfx_prompt_en"), 90)
    global_bpm = global_audio.get("bpm")

    visual_bible = visual_bible or {}
    visual_bible_parts = [
        f"Style: {_compact_text(visual_bible.get('style_name'), 80)}",
        f"Aesthetic: {_compact_text(visual_bible.get('aesthetic_principles'), 120)}",
        f"Cinematography: {_compact_text(visual_bible.get('cinematography_rules'), 120)}",
        f"Lighting: {_compact_text(visual_bible.get('lighting_rules'), 120)}",
        f"Color: {_compact_text(visual_bible.get('color_rules'), 100)}",
        f"Continuity: {_compact_text(visual_bible.get('continuity_rules'), 120)}",
        f"Negative: {_compact_text(visual_bible.get('negative_constraints'), 100)}",
    ]

    voice_lines: list[str] = []
    for ref in _dedupe_keep_order([str(ref) for ref in refs])[:MAX_VIDEO_REF_LINES]:
        element = world_map.get(ref) or {}
        voice_profile = element.get("voice_profile") or {}
        if isinstance(voice_profile, dict) and any(str(v).strip() for v in voice_profile.values() if v is not None):
            voice_name = str(voice_profile.get("voice_name") or voice_profile.get("voice_id") or ref)
            timbre = _compact_text(voice_profile.get("timbre"), 30)
            style = _compact_text(voice_profile.get("speaking_style"), 40)
            pace = voice_profile.get("pace_wpm")
            accent = _compact_text(voice_profile.get("accent"), 30)
            reference_line = _compact_text(voice_profile.get("reference_line"), 45)
            voice_bits = [f"{voice_name}"]
            if timbre:
                voice_bits.append(f"timbre={timbre}")
            if style:
                voice_bits.append(f"style={style}")
            if pace:
                voice_bits.append(f"pace={pace}wpm")
            if accent:
                voice_bits.append(f"accent={accent}")
            if reference_line:
                voice_bits.append(f"reference='{reference_line}'")
            voice_lines.append(f"{ref}: " + ", ".join(voice_bits))
    voice_lines = _dedupe_keep_order(voice_lines)[:MAX_VIDEO_DIALOGUE_LINES]
    audition_labels: list[str] = []
    if isinstance(selected_world_video_refs, list):
        for idx, ref_info in enumerate(selected_world_video_refs, start=1):
            label = str(ref_info.get("label") or f"@video {idx}").strip()
            if label:
                audition_labels.append(label)
    audition_labels = _dedupe_keep_order(audition_labels)[:MAX_VIDEO_REF_LINES]

    subshots = shot.get("subshots") or []
    beat_lines: list[str] = []
    if isinstance(subshots, list):
        for sub in subshots[:MAX_VIDEO_BEAT_LINES]:
            if not isinstance(sub, dict):
                continue
            label = _compact_text(sub.get("label"), 24)
            start_offset = sub.get("start_offset_sec")
            end_offset = sub.get("end_offset_sec")
            beat_description = _compact_text(sub.get("beat_description"), 70)
            camera = _compact_text(sub.get("camera"), 30)
            action = _compact_text(sub.get("action"), 35)
            beat = f"{start_offset}-{end_offset}s {label}: {beat_description}".strip()
            extras = " | ".join(part for part in (camera, action) if part)
            beat_lines.append(f"{beat}{' | ' + extras if extras else ''}")

    dialogue_line_texts: list[str] = []
    if isinstance(dialogue_lines, list):
        for line in dialogue_lines[:MAX_VIDEO_DIALOGUE_LINES]:
            if not isinstance(line, dict):
                continue
            speaker_name = str(line.get("speaker_name") or line.get("speaker_code") or "")
            voice_ref = _compact_text(line.get("voice_ref"), 20)
            text = _compact_text(line.get("text"), 60)
            delivery = _compact_text(line.get("delivery"), 40)
            pace = _compact_text(line.get("pace"), 20)
            start_offset = line.get("start_offset_sec")
            end_offset = line.get("end_offset_sec")
            if not (speaker_name or text):
                continue
            fragments = [f"{speaker_name}: {text}".strip()]
            if isinstance(start_offset, (int, float)) and isinstance(end_offset, (int, float)):
                fragments.append(f"window={float(start_offset):.2f}-{float(end_offset):.2f}s")
            if voice_ref:
                fragments.append(f"voice_ref={voice_ref}")
            if delivery:
                fragments.append(f"delivery={delivery}")
            if pace:
                fragments.append(f"pace={pace}")
            dialogue_line_texts.append(" | ".join(fragments))
    dialogue_line_texts = _dedupe_keep_order(dialogue_line_texts)

    integrated_audio_parts: list[str] = []
    if dialogue or dialogue_line_texts or voice_direction:
        integrated_audio_parts.append("generate synchronized audible dialogue with clean lip sync")
    if sound_effects:
        integrated_audio_parts.append(f"shot SFX/ambience={sound_effects}")
    elif global_sfx_prompt:
        integrated_audio_parts.append(f"package SFX/ambience={global_sfx_prompt}")
    if global_music_prompt:
        if dialogue or dialogue_line_texts:
            integrated_audio_parts.append(f"optional low-mix BGM={global_music_prompt}")
        else:
            integrated_audio_parts.append(f"music/BGM={global_music_prompt}")
    if global_bpm:
        integrated_audio_parts.append(f"tempo={global_bpm} bpm")
    integrated_audio_line = (
        _compact_text("Integrated audio: " + " ; ".join(integrated_audio_parts), 220)
        if integrated_audio_parts
        else ""
    )
    audio_mix_line = ""
    if dialogue or dialogue_line_texts:
        audio_mix_line = "Audio mix priority: dialogue first, key diegetic effects second, keep any score under the voices."

    previous_tail = ""
    if isinstance(prev_shot, dict):
        prev_subshots = prev_shot.get("subshots") if isinstance(prev_shot.get("subshots"), list) else []
        prev_last = prev_subshots[-1] if prev_subshots and isinstance(prev_subshots[-1], dict) else {}
        previous_tail = _compact_text(
            prev_last.get("beat_description")
            or prev_shot.get("continuity_note")
            or prev_shot.get("character_action")
            or prev_shot.get("shot_description"),
            100,
        )

    next_hook = ""
    if isinstance(next_shot, dict):
        next_subshots = next_shot.get("subshots") if isinstance(next_shot.get("subshots"), list) else []
        next_first = next_subshots[0] if next_subshots and isinstance(next_subshots[0], dict) else {}
        next_hook = _compact_text(
            next_first.get("beat_description")
            or next_shot.get("continuity_note")
            or next_shot.get("character_action")
            or next_shot.get("shot_description"),
            100,
        )

    current_first_beat = ""
    current_last_beat = ""
    if isinstance(subshots, list) and subshots:
        first_sub = subshots[0] if isinstance(subshots[0], dict) else {}
        last_sub = subshots[-1] if isinstance(subshots[-1], dict) else {}
        current_first_beat = _compact_text(
            first_sub.get("beat_description")
            or first_sub.get("action")
            or shot_description
            or character_action,
            100,
        )
        current_last_beat = _compact_text(
            last_sub.get("beat_description")
            or last_sub.get("action")
            or character_action
            or shot_description,
            100,
        )

    concise_style_line = " | ".join(
        part for part in (
            _compact_text(visual_bible.get("style_name"), 50),
            _compact_text(visual_bible.get("cinematography_rules"), 100),
            _compact_text(visual_bible.get("lighting_rules"), 90),
            _compact_text(visual_bible.get("color_rules"), 80),
        ) if part
    )

    direct_scene_rules: list[str] = [
        "Use the ordered @video N and @image N bindings above as the only reference map.",
        "Do not restate the reference catalog, do not rename assets, and do not repeat identity/location summaries.",
        "Never render input videos or input images as quick flashes, inserted frames, picture-in-picture, montage cutaways, or visible reference plates; they must be integrated invisibly as continuity, identity, staging, and design locks.",
        "Move straight into the formal scene and express continuity, blocking, acting, and camera design by directly referring to @video N and @image N when needed.",
        "Write the scene as a production-ready 15-second execution prompt with performance, staging, subshots, dialogue breaths, micro-expressions, action beats, and multi-camera coverage.",
    ]
    if audition_labels:
        direct_scene_rules.append(
            "When performance or world-motion carry matters, reference these anchors directly inside the scene action: "
            + ", ".join(audition_labels)
            + "."
        )

    prompt_parts = [
        f"REFERENCE LOCK {binding_lock}.",
        " ".join(direct_scene_rules),
        "Core cinema lock: 2.35:1 anamorphic widescreen intent, highest practical resolution, 85mm focal length, T1.8 aperture, ARRI Master Primes lens feel, subtle film grain, bloom/halation, natural 24fps shutter-rule motion blur, top-tier cinematic CG texture, strong narrative tension, deep background defocus with oval bokeh.",
        f"Formal clip requirement: build one continuous {CANONICAL_DURATION_SECONDS}-second dramatic scene, usually 4-8 motivated subshots with readable multi-camera coverage unless a sustained take is dramatically superior.",
        "Unless the user explicitly requests a sustained take, every 2-second window should contain a meaningful camera beat, blocking change, performance escalation, or action punctuation.",
        "Keep multi-camera coverage abundant, but make the clip feel like one coherent dramatic event rather than a collage.",
        "For action, fight, chase, transformation, impact, or combat beats: split the 15 seconds into 4-5 core action intervals and include exact 0.1s hit marks. Every hit mark must specify impact frame, screen shake, and particle/material ejection such as electric sparks, metal fragments, dust, debris, smoke, or energy pulses.",
        "Action camera rule: avoid centered static composition. Prefer orbital, handheld tracking, dolly zoom, motivated lateral tracking, impact push-in, recovery drift, quick editorial cutting, readable geography, and one dominant camera intention per time slice.",
        "Action wording rule: preserve asset identity 1:1, and avoid biological gore language; describe structural components, kinetic stress posture, armor plates, energy pulses, material response, silhouette deformation, and mechanical collapse instead.",
        "Make the internal cuts feel motivated and continuous: preserve eyeline logic, screen direction, movement flow, prop continuity, and sound carry whenever relevant.",
        "If dialogue is present, protect spoken performance and lip-sync continuity: let angle changes support the speaker, listener reaction, interruption, subtext, and emotional shift instead of breaking the line unnaturally.",
        f"If dialogue is present, every spoken line must be fully, clearly, and emotionally performed within this {CANONICAL_DURATION_SECONDS}-second clip. Do not over-write dialogue, do not rush delivery unnaturally, and do not let a line get clipped by the shot end.",
        "If dialogue timing windows are provided, each line must start, breathe, peak, and finish inside its own assigned window; no line may spill across a clip boundary or get chopped at an internal cut.",
        "Keep dialogue, acting reactions, and micro-expressions rich and playable; emotional texture should stay visible inside the camera design, not only in exposition text.",
        "Start from the carried-over state instead of replaying the previous clip's ending, and end on a clean bridge into the next clip instead of duplicating the next opening.",
        f"Visual direction: {concise_style_line}" if concise_style_line else "",
        "Voice consistency anchors: " + " ; ".join(voice_lines) if voice_lines else "",
        f"Scene setup: {shot_description}" if shot_description else "",
        f"Primary performance line: {character_action}" if character_action else "",
        f"Emotional and micro-expression line: {emotion}" if emotion else "",
        f"Framing and shot size: {shot_size}" if shot_size else "",
        f"Camera plan: {camera_language}" if camera_language else "",
        f"Composition and blocking: {composition_notes}" if composition_notes else "",
        f"Lighting and atmosphere: {lighting_mood}" if lighting_mood else "",
        f"Texture and aesthetic finish: {aesthetic_notes}" if aesthetic_notes else "",
        f"Palette and color pressure: {palette_notes}" if palette_notes else "",
        f"Continuity carry: {continuity_note}" if continuity_note else "",
        f"Previous-scene momentum: {previous_tail}" if previous_tail else "",
        f"Opening beat to pick up immediately: {current_first_beat}" if current_first_beat else "",
        f"Ending bridge to hand off cleanly: {current_last_beat}" if current_last_beat else "",
        f"Next-scene hook to plant: {next_hook}" if next_hook else "",
        f"Spoken dialogue spine: {dialogue}" if dialogue else "",
        f"Voice, breath, and delivery: {voice_direction}" if voice_direction else "",
        "Dialogue windows and breath map: " + " ; ".join(dialogue_line_texts) if dialogue_line_texts else "",
        f"Effects and contact sound: {sound_effects}" if sound_effects else "",
        integrated_audio_line,
        audio_mix_line,
        "Editing bridge rule: every cut and clip boundary must feel motivated by story energy, action continuation, reaction, eyeline, breath, or sound carry.",
        f"Subshot / action beat plan: " + " ; ".join(beat_lines) if beat_lines else "",
        "Direct scene push: " + _compact_text(base_prompt, 220) if _compact_text(base_prompt, 220) else "",
    ]
    final_prompt = " ".join(part for part in prompt_parts if part).strip()
    if len(final_prompt) <= MAX_VIDEO_PROMPT_CHARS:
        return final_prompt

    fallback_parts = [
        f"REFERENCE LOCK {binding_lock}.",
        "Use the @video N / @image N bindings above directly. Do not restate the asset catalog.",
        f"Visual direction: {concise_style_line}" if concise_style_line else "",
        f"Shot: {shot_description}" if shot_description else "",
        f"Performance: {character_action}" if character_action else "",
        f"Micro-expression: {emotion}" if emotion else "",
        f"Camera and blocking: {' | '.join(part for part in (camera_language, composition_notes) if part)}" if (camera_language or composition_notes) else "",
        f"Lighting: {lighting_mood}" if lighting_mood else "",
        f"Dialogue / breath: {' | '.join(part for part in (dialogue, voice_direction) if part)}" if (dialogue or voice_direction) else "",
        "Beat plan: " + " ; ".join(beat_lines[:4]) if beat_lines else "",
        f"SFX: {sound_effects or global_sfx_prompt}" if (sound_effects or global_sfx_prompt) else "",
        f"Music: {global_music_prompt}" if global_music_prompt else "",
        "Scene push: " + _compact_text(base_prompt, 180) if _compact_text(base_prompt, 180) else "",
    ]
    return _compact_text(" ".join(part for part in fallback_parts if part).strip(), MAX_VIDEO_PROMPT_CHARS)


@dataclass
class KeyframePlanItem:
    plan_index: int
    shot_index: int
    kind: str  # "single" | "flf_first" | "flf_last"
    prompt: str
    method: str  # generate_image | edit_image
    ref_shot_index: Optional[int] = None
    ref_url: Optional[str] = None
    world_refs: tuple[str, ...] = field(default_factory=tuple)


@dataclass
class VideoPlanItem:
    shot_index: int
    mode: str  # image_to_video | first_last_frame
    prompt: str
    world_refs: tuple[str, ...] = field(default_factory=tuple)
    primary_world_ref: Optional[str] = None
    binding_lock: Optional[str] = None
    input_image_url: Optional[str] = None
    first_frame_url: Optional[str] = None
    last_frame_url: Optional[str] = None


@dataclass
class VideoGenerationResult:
    clip_index: int
    shot_index: int
    mode: str
    public_url: str
    mime_type: str
    prompt: str
    input_image_url: Optional[str]
    provider_video_url: Optional[str] = None
    reference_image_urls: list[str] = field(default_factory=list)
    reference_video_urls: list[str] = field(default_factory=list)
    last_frame_url: Optional[str] = None
    tool_name: str = "generate_video"
    binding_lock: Optional[str] = None
    world_refs: list[str] = field(default_factory=list)
    primary_world_ref: Optional[str] = None
    voice_direction: Optional[str] = None
    dialogue_lines: list[dict[str, Any]] = field(default_factory=list)
    request_attempts: int = 1
    request_id: Optional[str] = None
    base_request_id: Optional[str] = None
    fresh_request_attempts: int = 1
    clip_attempt: int = 1


def _stable_agent_request_id(raw_value: str) -> str:
    raw = str(raw_value or "").strip()
    if not raw:
        return str(uuid.uuid4())
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        return str(uuid.uuid5(AGENT_REQUEST_NAMESPACE, raw))


def _next_clip_attempt(clip_attempts_by_index: dict[int, int], clip_index: int) -> int:
    attempt = int(clip_attempts_by_index.get(int(clip_index), 0) or 0) + 1
    clip_attempts_by_index[int(clip_index)] = attempt
    return attempt


def _pick_ref_url_by_shot_index(keyframes_by_shot: dict[int, str], ref_shot_index: Optional[int]) -> Optional[str]:
    if not ref_shot_index:
        return None
    return keyframes_by_shot.get(int(ref_shot_index))


def _build_plan(storyboard: dict) -> tuple[list[KeyframePlanItem], list[VideoPlanItem], dict]:
    shots = storyboard.get("shots") or []
    aspect_ratio = normalize_generation_aspect_ratio(storyboard.get("aspect_ratio"), default="16:9")

    keyframe_plan: list[KeyframePlanItem] = []
    video_plan: list[VideoPlanItem] = []

    plan_counter = 0
    prev_was_flf = False

    for shot in shots:
        if not isinstance(shot, dict):
            continue
        shot_index = int(shot.get("index") or 0)
        if shot_index <= 0:
            continue

        mode = _norm_mode(shot.get("recommended_video_mode"))
        method = _norm_method(shot.get("recommended_keyframe_method"))
        ref_shot_index = shot.get("reference_keyframe_index")

        world_refs = _extract_shot_world_refs(shot)
        primary_world_ref = str(shot.get("video_primary_world_ref") or "").strip() or (world_refs[0] if world_refs else None)
        binding_lock = str(shot.get("binding_lock") or f"SHOT_{shot_index:03d}_LOCK")

        visual_prompt = shot.get("visual_prompt_en") or ""
        motion_prompt = shot.get("motion_prompt_en") or ""
        keyframe_prompt = shot.get("keyframe_prompt_en") or visual_prompt
        keyframe_edit_prompt = shot.get("keyframe_edit_prompt_en") or ""
        first_prompt = shot.get("first_frame_prompt_en") or keyframe_prompt or visual_prompt
        last_prompt = shot.get("last_frame_prompt_en") or keyframe_prompt or visual_prompt

        # Enforce canonical duration in prompts (no "s").
        def _ensure_duration(p: str) -> str:
            if not isinstance(p, str):
                return ""
            if re.search(rf"\bduration\s*[:=]?\s*{CANONICAL_DURATION_SECONDS}\b", p, flags=re.IGNORECASE):
                return p
            return p.rstrip().rstrip(".") + f", duration: {CANONICAL_DURATION_SECONDS}"

        visual_prompt = _ensure_duration(visual_prompt)
        motion_prompt = _ensure_duration(motion_prompt)
        keyframe_prompt = _ensure_duration(keyframe_prompt)
        keyframe_edit_prompt = _ensure_duration(keyframe_edit_prompt) if keyframe_edit_prompt else ""
        first_prompt = _ensure_duration(first_prompt)
        last_prompt = _ensure_duration(last_prompt)

        def _default_edit_instruction(target: str) -> str:
            base = (
                "Edit the image. Keep the same subject identity, face/body/outfit (if any), "
                "same camera angle and framing, same lens/DOF, same color grading and art style. "
                "Change only what is necessary to match: "
            )
            return _ensure_duration(base + target)

        # If a reference keyframe is provided, prefer edit_image for continuity even if the model said generate_image.
        if ref_shot_index is not None and method == "generate_image":
            method = "edit_image"

        # If this shot references World elements, prefer edit_image so we can anchor identity/style.
        if world_refs and method == "generate_image":
            method = "edit_image"

        if method == "skip":
            method = "edit_image" if world_refs else "generate_image"

        if method == "edit_image" and not keyframe_edit_prompt:
            keyframe_edit_prompt = _default_edit_instruction(keyframe_prompt or visual_prompt)

        if mode == "image_to_video":
            plan_counter += 1
            keyframe_plan.append(
                KeyframePlanItem(
                    plan_index=plan_counter,
                    shot_index=shot_index,
                    kind="single",
                    prompt=keyframe_edit_prompt if method == "edit_image" else keyframe_prompt,
                    method=method,
                    ref_shot_index=int(ref_shot_index) if ref_shot_index is not None else None,
                    world_refs=tuple(world_refs),
                )
            )
            video_plan.append(
                VideoPlanItem(
                    shot_index=shot_index,
                    mode="image_to_video",
                    prompt=motion_prompt,
                    world_refs=tuple(world_refs),
                    primary_world_ref=primary_world_ref,
                    binding_lock=binding_lock,
                )
            )
            prev_was_flf = False
            continue

        # first_last_frame:
        # If consecutive FLF, we reuse previous last frame as this first frame => only need new last keyframe.
        # If previous shot was NOT FLF (including image_to_video), we MUST create a NEW first keyframe.
        if prev_was_flf:
            plan_counter += 1
            keyframe_plan.append(
                KeyframePlanItem(
                    plan_index=plan_counter,
                    shot_index=shot_index,
                    kind="flf_last",
                    prompt=_default_edit_instruction(last_prompt),
                    # Consecutive FLF: the first frame is reused from previous segment's last frame,
                    # so the new last frame MUST be edited from that reused first frame for continuity.
                    method="edit_image",
                    ref_shot_index=None,
                    world_refs=tuple(world_refs),
                )
            )
        else:
            plan_counter += 1
            keyframe_plan.append(
                KeyframePlanItem(
                    plan_index=plan_counter,
                    shot_index=shot_index,
                    kind="flf_first",
                    prompt=keyframe_edit_prompt if method == "edit_image" else first_prompt,
                    method=method,
                    ref_shot_index=int(ref_shot_index) if ref_shot_index is not None else None,
                    world_refs=tuple(world_refs),
                )
            )
            plan_counter += 1
            keyframe_plan.append(
                KeyframePlanItem(
                    plan_index=plan_counter,
                    shot_index=shot_index,
                    kind="flf_last",
                    prompt=_default_edit_instruction(last_prompt),
                    # For within-shot consistency, last frame prefers edit_image from the first frame.
                    method="edit_image",
                    ref_shot_index=shot_index,  # reference the first keyframe of this shot
                    world_refs=tuple(world_refs),
                )
            )

        video_plan.append(
            VideoPlanItem(
                shot_index=shot_index,
                mode="first_last_frame",
                prompt=motion_prompt,
                world_refs=tuple(world_refs),
                primary_world_ref=primary_world_ref,
                binding_lock=binding_lock,
            )
        )
        prev_was_flf = True

    meta = {"aspect_ratio": aspect_ratio, "canonical_duration_seconds": CANONICAL_DURATION_SECONDS}
    return keyframe_plan, video_plan, meta


@tool(
    "execute_storyboard",
    description=(
        "Execute a storyboard deterministically: generate Script Track assets first, then short World Track audition/orbit videos for recurring characters/locations/props, then generate formal clips using those world-video anchors within the 15-second total reference-video budget. "
        "Keyframe generation is optional and no longer the default path."
    ),
    args_schema=ExecuteStoryboardInputSchema,
)
async def execute_storyboard(
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    storyboard_json: Optional[str] = None,
    dry_run: Optional[bool] = False,
    phase: Optional[str] = "all",
    resume: Optional[bool] = True,
) -> str:
    ctx = config.get("configurable", {}) or {}
    canvas_id = ctx.get("canvas_id")
    session_id = ctx.get("session_id")
    user_id = ctx.get("user_id") or session_id
    preferred_language = str(ctx.get("preferred_language") or "").strip()
    uploaded_image_urls = [
        str(url).strip()
        for url in (ctx.get("uploaded_image_urls") or [])
        if str(url).strip()
    ]
    uploaded_video_urls = [
        str(url).strip()
        for url in (ctx.get("uploaded_video_urls") or [])
        if str(url).strip()
    ]
    uploaded_audio_urls = [
        str(url).strip()
        for url in (ctx.get("uploaded_audio_urls") or [])
        if str(url).strip()
    ]
    user_wants_self_insert = bool(ctx.get("user_wants_self_insert"))
    if not canvas_id or not session_id:
        return "execute_storyboard failed: missing canvas_id/session_id"

    messages = ctx.get("messages") or []
    persisted_messages_for_resume: Optional[list[dict]] = None
    resume_state = _load_latest_resume_state_from_messages(messages) if resume else None

    storyboard: Optional[dict] = None
    if storyboard_json:
        try:
            storyboard = json.loads(storyboard_json)
        except Exception as e:
            cached_storyboard = get_latest_structured_output(canvas_id=canvas_id, session_id=session_id)
            if cached_storyboard:
                storyboard = cached_storyboard
            else:
                return f"execute_storyboard failed: invalid storyboard_json: {e}"
    else:
        storyboard = get_latest_structured_output(canvas_id=canvas_id, session_id=session_id)
        if not storyboard:
            storyboard = _load_storyboard_from_messages(messages)
        if not storyboard:
            persisted_messages_for_resume = await fetch_session_messages(session_id=session_id)
            storyboard = _load_storyboard_from_messages(persisted_messages_for_resume)
            if resume and not resume_state:
                resume_state = _load_latest_resume_state_from_messages(persisted_messages_for_resume)

    if not storyboard:
        return "execute_storyboard failed: no storyboard found (pass storyboard_json or ensure last tool output contains JSON)."

    delegated_result = await _try_delegate_storyboard_to_acp(
        canvas_id=canvas_id,
        session_id=session_id,
        user_id=user_id,
        storyboard=storyboard,
        storyboard_json=storyboard_json,
        dry_run=bool(dry_run),
        phase=str(phase or "all"),
        resume=bool(resume),
    )
    if delegated_result:
        return delegated_result

    # Normalize world refs BEFORE building the plan so we can always anchor edit_image to a World reference image.
    world_norm = _normalize_world_refs_for_storyboard(storyboard)

    keyframe_plan, video_plan, meta = _build_plan(storyboard)
    aspect_ratio = meta["aspect_ratio"]

    if dry_run:
        return json.dumps(
            {
                "meta": meta,
                "worldNormalization": world_norm,
                "keyframes": [item.__dict__ for item in keyframe_plan],
                "videos": [item.__dict__ for item in video_plan],
            },
            ensure_ascii=False,
            indent=2,
        )

    img_gen = ReelMindGenerator()
    img_edit = ReelMindImageEditGenerator()
    vid_gen = ReelMindVideoGenerator()
    world_map = _world_elements_by_id(storyboard)
    visual_bible = storyboard.get("visual_bible") or storyboard.get("visualBible") or {}
    primary_user_character_id = _primary_user_character_element_id(_extract_world_elements(storyboard))

    requested_phase_norm = (phase or "all").strip().lower()
    run_keyframes = requested_phase_norm in {"keyframes", "keyframe"}
    run_videos = requested_phase_norm in {"all", "videos", "video"}

    # Load current canvas timeline once, so we can optionally resume/skip duplicates.
    canvas = await api_client_service.get_canvas_data(canvas_id, user_id=user_id)
    if canvas is None:
        canvas = {"data": {}}
    canvas_data = canvas.get("data", {}) if isinstance(canvas, dict) else {}

    def _storyboard_fingerprint(sb: dict) -> str:
        payload = {
            "title": sb.get("title"),
            "premise": sb.get("premise"),
            "style": sb.get("style"),
            "visual_bible": sb.get("visual_bible") or sb.get("visualBible"),
            "aspect_ratio": sb.get("aspect_ratio"),
            "total_duration_seconds": sb.get("total_duration_seconds"),
            "story_metrics": sb.get("story_metrics"),
            "shots": [
                {
                    "index": s.get("index"),
                    "start_sec": s.get("start_sec"),
                    "end_sec": s.get("end_sec"),
                    "duration_seconds": s.get("duration_seconds"),
                    "binding_lock": s.get("binding_lock"),
                    "shot_description": s.get("shot_description"),
                    "shot_size": s.get("shot_size"),
                    "character_action": s.get("character_action"),
                    "emotion": s.get("emotion"),
                    "scene_tag": s.get("scene_tag"),
                    "lighting_mood": s.get("lighting_mood"),
                    "aesthetic_notes": s.get("aesthetic_notes"),
                    "composition_notes": s.get("composition_notes"),
                    "camera_language": s.get("camera_language"),
                    "palette_notes": s.get("palette_notes"),
                    "dialogue": s.get("dialogue"),
                    "sound_effects": s.get("sound_effects"),
                    "world_refs": s.get("world_refs") or s.get("worldRefs"),
                    "video_primary_world_ref": s.get("video_primary_world_ref"),
                    "visual_prompt_en": s.get("visual_prompt_en"),
                    "motion_prompt_en": s.get("motion_prompt_en"),
                    "recommended_keyframe_method": s.get("recommended_keyframe_method"),
                    "recommended_video_mode": s.get("recommended_video_mode"),
                }
                for s in (sb.get("shots") or [])
                if isinstance(s, dict)
            ],
            "screenplay": sb.get("screenplay"),
            "bible": sb.get("bible"),
            "world": sb.get("world"),
            "script_segments": sb.get("script_segments") or sb.get("scriptSegments"),
        }
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    storyboard_fp = _storyboard_fingerprint(storyboard)
    if resume and not resume_state:
        if persisted_messages_for_resume is None:
            persisted_messages_for_resume = await fetch_session_messages(session_id=session_id)
        resume_state = _load_latest_resume_state_from_messages(persisted_messages_for_resume)

    storyboard_run_id = ""
    if isinstance(resume_state, dict):
        storyboard_run_id = str(resume_state.get("storyboardRunId") or resume_state.get("runId") or "").strip()
    if not storyboard_run_id:
        storyboard_run_id = f"storyboard-run-{_stable_agent_request_id(f'{session_id}-{storyboard_fp}')}"

    clip_attempts_by_index: dict[int, int] = {}
    if isinstance(resume_state, dict):
        raw_clip_attempts = resume_state.get("clipAttempts")
        if isinstance(raw_clip_attempts, dict):
            for raw_idx, raw_attempt in raw_clip_attempts.items():
                try:
                    clip_idx = int(raw_idx)
                    attempt = int(raw_attempt)
                except Exception:
                    continue
                if clip_idx > 0 and attempt > 0:
                    clip_attempts_by_index[clip_idx] = attempt
        failed_clip_index = resume_state.get("failedClipIndex")
        try:
            failed_clip_idx = int(failed_clip_index)
        except Exception:
            failed_clip_idx = 0
        if failed_clip_idx > 0:
            clip_attempts_by_index[failed_clip_idx] = max(clip_attempts_by_index.get(failed_clip_idx, 0), 1)

    def _draft_script_asset_id(shot_index: int) -> str:
        safe_session = re.sub(r"[^a-zA-Z0-9]+", "", str(session_id or ""))[:12] or "session"
        return f"script-draft-{safe_session}-{int(shot_index):03d}"

    def _existing_script_assets() -> list[dict]:
        timeline = (canvas_data or {}).get("timeline") or {}
        tracks = timeline.get("tracks") or []
        script_track = next((t for t in tracks if t.get("id") == "script-track"), None)
        return (script_track or {}).get("assets") or []

    def _existing_world_assets() -> list[dict]:
        timeline = (canvas_data or {}).get("timeline") or {}
        tracks = timeline.get("tracks") or []
        world_track = next((t for t in tracks if t.get("id") == "world-track"), None)
        return (world_track or {}).get("assets") or []

    existing_script_assets = _existing_script_assets()
    existing_script_asset_ids = {a.get("id") for a in existing_script_assets if isinstance(a, dict) and a.get("id")}

    existing_world_assets = _existing_world_assets() if resume else []
    existing_world_assets_by_id = {
        str(asset.get("id")): asset
        for asset in existing_world_assets
        if isinstance(asset, dict) and asset.get("id")
    }
    existing_world_asset_ids = {a.get("id") for a in existing_world_assets if isinstance(a, dict) and a.get("id")}
    existing_world_video_ready_asset_ids: set[str] = set()

    world_images_by_id: dict[str, str] = {}
    world_video_refs_by_id: dict[str, dict[str, Any]] = {}
    available_continuity_tail_refs_by_clip: dict[int, dict[str, Any]] = {}
    world_track_cursor_holder = {
        "value": max(
            (
                float(asset.get("startTime") or 0) + float(asset.get("duration") or 0)
                for asset in existing_world_assets
                if isinstance(asset, dict)
            ),
            default=0.0,
        )
    }
    for asset in existing_world_assets:
        if not isinstance(asset, dict):
            continue
        md = (asset.get("metadata") or {}) if isinstance(asset.get("metadata"), dict) else {}
        if md.get("kind") == "clip_continuity_tail" or md.get("isContinuityTail"):
            source_clip_index = md.get("sourceClipIndex")
            content = asset.get("content") or {}
            public_video_url = (
                content.get("videoUrl")
                or md.get("publicVideoUrl")
                or md.get("resourceUrl")
                or md.get("sourcePublicVideoUrl")
            )
            if isinstance(source_clip_index, (int, float)) and isinstance(public_video_url, str) and public_video_url.strip():
                clip_idx = int(source_clip_index)
                available_continuity_tail_refs_by_clip[clip_idx] = {
                    "source_clip_index": clip_idx,
                    "source_shot_index": md.get("sourceShotIndex"),
                    "preferred_video_url": public_video_url.strip(),
                    "public_video_url": public_video_url.strip(),
                    "poster_url": content.get("thumbnailUrl") or public_video_url.strip(),
                    "duration_seconds": float(asset.get("duration") or md.get("tailDurationSeconds") or CONTINUITY_TAIL_DURATION_SECONDS),
                    "source_public_video_url": md.get("sourcePublicVideoUrl"),
                    "source_type": "tail",
                    "reference_kind": "连续性尾段参考",
                    "name": str(md.get("name") or f"Clip {clip_idx} continuity tail"),
                }
            continue
        element_id = md.get("elementId") or md.get("worldId") or md.get("code")
        if not isinstance(element_id, str) or not element_id.strip():
            continue
        content = asset.get("content") or {}
        url = (content.get("imageUrl") or content.get("thumbnailUrl") or md.get("resourceUrl"))
        if isinstance(url, str) and url:
            world_images_by_id[element_id.strip()] = url
        provider_video_url = (
            md.get("sourceProviderVideoUrl")
            or md.get("providerVideoUrl")
            or md.get("preferredProviderVideoUrl")
        )
        source_public_video_url = md.get("sourcePublicVideoUrl") or md.get("rawPublicVideoUrl")
        public_video_url = content.get("videoUrl") or md.get("publicVideoUrl") or md.get("resourceUrl") or source_public_video_url
        preferred_video_url = provider_video_url or public_video_url or source_public_video_url
        if isinstance(preferred_video_url, str) and preferred_video_url:
            existing_world_video_ready_asset_ids.add(str(asset.get("id") or ""))
            element = world_map.get(element_id.strip()) or {}
            world_video_refs_by_id[element_id.strip()] = {
                "element_id": element_id.strip(),
                "name": str(md.get("name") or element.get("name") or element_id).strip(),
                "reference_kind": _world_video_reference_kind_label(element),
                "label": "",
                "preferred_video_url": preferred_video_url,
                "public_video_url": public_video_url if isinstance(public_video_url, str) and public_video_url else preferred_video_url,
                "provider_video_url": provider_video_url if isinstance(provider_video_url, str) and provider_video_url else None,
                "poster_url": (
                    content.get("thumbnailUrl")
                    or content.get("imageUrl")
                    or public_video_url
                    or source_public_video_url
                    or preferred_video_url
                ),
                "duration_seconds": float(
                    asset.get("duration")
                    or md.get("generationDurationSeconds")
                    or WORLD_ASSET_REFERENCE_DURATION_SECONDS
                ),
                "source_public_video_url": (
                    source_public_video_url if isinstance(source_public_video_url, str) and source_public_video_url else None
                ),
            }

    # Script/world track assets are added later, after tool-card helpers are initialized.

    def _existing_storyboard_keyframes() -> dict[tuple[int, str], str]:
        timeline = (canvas_data or {}).get("timeline") or {}
        tracks = timeline.get("tracks") or []
        keyframe_track = next((t for t in tracks if t.get("id") == "keyframe-track"), None)
        assets = (keyframe_track or {}).get("assets") or []
        found: dict[tuple[int, str], str] = {}
        for asset in assets:
            md = (asset or {}).get("metadata") or {}
            sb = md.get("storyboard") or {}
            if not isinstance(sb, dict):
                continue
            shot_idx = sb.get("shotIndex")
            kind = sb.get("kind")
            if not isinstance(kind, str):
                continue
            if not isinstance(shot_idx, (int, float)):
                continue
            url = (((asset or {}).get("content") or {}).get("imageUrl")) or md.get("resourceUrl")
            if isinstance(url, str) and url:
                found[(int(shot_idx), kind)] = url
        return found

    def _existing_storyboard_videos() -> dict[tuple[int, str], str]:
        timeline = (canvas_data or {}).get("timeline") or {}
        tracks = timeline.get("tracks") or []
        video_track = next((t for t in tracks if t.get("id") == "video-track"), None)
        assets = (video_track or {}).get("assets") or []
        found: dict[tuple[int, str], str] = {}
        for asset in assets:
            md = (asset or {}).get("metadata") or {}
            sb = md.get("storyboard") or {}
            if not isinstance(sb, dict):
                continue
            shot_idx = sb.get("shotIndex")
            mode = sb.get("mode")
            if not isinstance(mode, str):
                continue
            if not isinstance(shot_idx, (int, float)):
                continue
            url = (((asset or {}).get("content") or {}).get("videoUrl")) or md.get("resourceUrl")
            if isinstance(url, str) and url:
                found[(int(shot_idx), mode)] = url
        return found

    existing_keyframes = _existing_storyboard_keyframes() if resume else {}
    existing_videos = _existing_storyboard_videos() if resume else {}

    # Clip indexing is the true timeline ordering for canonical-duration videos.
    clips: list[dict[str, Any]] = []
    shot_to_clip_index: dict[int, int] = {}
    shots_by_index: dict[int, dict[str, Any]] = {}
    for shot in (storyboard.get("shots") or []):
        if isinstance(shot, dict) and isinstance(shot.get("index"), (int, float)):
            shots_by_index[int(shot.get("index"))] = shot
    for idx, vp in enumerate(video_plan, start=1):
        clips.append(
            {
                "clipIndex": idx,
                "shotIndex": vp.shot_index,
                "mode": vp.mode,
                "executionMode": "text_to_video" if idx == 1 else "video_to_video",
                "prompt": vp.prompt,
                "worldRefs": list(vp.world_refs),
                "primaryWorldRef": vp.primary_world_ref,
                "bindingLock": vp.binding_lock,
            }
        )
        shot_to_clip_index[vp.shot_index] = idx

    def _existing_aligned_keyframes() -> dict[tuple[int, str], dict]:
        timeline = (canvas_data or {}).get("timeline") or {}
        tracks = timeline.get("tracks") or []
        keyframe_track = next((t for t in tracks if t.get("id") == "keyframe-track"), None)
        assets = (keyframe_track or {}).get("assets") or []
        found: dict[tuple[int, str], dict] = {}
        legacy_found: dict[tuple[int, str], dict] = {}
        for asset in assets:
            md = (asset or {}).get("metadata") or {}
            sb = md.get("storyboard") or {}
            if not isinstance(sb, dict):
                continue
            asset_run_id = str(sb.get("storyboardRunId") or sb.get("runId") or "").strip()
            if asset_run_id and asset_run_id != storyboard_run_id:
                continue
            clip_idx = sb.get("clipIndex")
            role = sb.get("role")
            if not isinstance(role, str) or role not in {"single", "flf_first", "flf_last"}:
                continue
            if not isinstance(clip_idx, (int, float)):
                continue
            key = (int(clip_idx), role)
            if asset_run_id == storyboard_run_id:
                found[key] = asset
            elif key not in legacy_found:
                legacy_found[key] = asset
        for key, asset in legacy_found.items():
            found.setdefault(key, asset)
        return found

    def _coerce_positive_int(value: Any) -> Optional[int]:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            parsed = int(value)
            return parsed if parsed > 0 else None
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                parsed = int(float(text))
            except Exception:
                return None
            return parsed if parsed > 0 else None
        return None

    def _video_asset_url(asset: dict) -> str:
        content = (asset or {}).get("content") or {}
        metadata = (asset or {}).get("metadata") or {}
        for candidate in (
            content.get("videoUrl"),
            content.get("url"),
            metadata.get("resourceUrl"),
            metadata.get("videoUrl"),
            metadata.get("primaryVideoUrl"),
        ):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return ""

    def _infer_video_clip_index(asset: dict, fallback_order: int) -> Optional[int]:
        metadata = (asset or {}).get("metadata") or {}
        storyboard_meta = metadata.get("storyboard") or {}
        if not isinstance(storyboard_meta, dict):
            storyboard_meta = {}

        for candidate in (
            storyboard_meta.get("scriptClipIndex"),
            storyboard_meta.get("clipIndex"),
            metadata.get("scriptClipIndex"),
            metadata.get("clipIndex"),
            (asset or {}).get("scriptClipIndex"),
            (asset or {}).get("clipIndex"),
        ):
            clip_index = _coerce_positive_int(candidate)
            if clip_index:
                return clip_index

        script_asset_id = str(storyboard_meta.get("scriptAssetId") or metadata.get("scriptAssetId") or "").strip()
        if script_asset_id:
            match = re.search(r"(\d+)$", script_asset_id)
            if match:
                clip_index = _coerce_positive_int(match.group(1))
                if clip_index:
                    return clip_index

        for candidate in (
            (asset or {}).get("startTime"),
            metadata.get("startTime"),
            ((metadata.get("editHistory") or [{}])[-1].get("newValue") or {}).get("startTime")
            if isinstance(metadata.get("editHistory"), list) and metadata.get("editHistory")
            else None,
        ):
            try:
                start_time = float(candidate)
            except Exception:
                continue
            if start_time < 0:
                continue
            return int(start_time // CANONICAL_DURATION_SECONDS) + 1

        return fallback_order if fallback_order > 0 else None

    def _video_asset_sort_start(asset: dict) -> float:
        for candidate in ((asset or {}).get("startTime"), ((asset or {}).get("metadata") or {}).get("startTime")):
            try:
                return float(candidate)
            except Exception:
                continue
        return float(10**9)

    def _existing_aligned_videos() -> dict[int, dict]:
        timeline = (canvas_data or {}).get("timeline") or {}
        tracks = timeline.get("tracks") or []
        video_track = next((t for t in tracks if t.get("id") == "video-track"), None)
        assets = (video_track or {}).get("assets") or []
        found: dict[int, dict] = {}
        legacy_found: dict[int, dict] = {}
        sorted_assets = sorted(
            [asset for asset in assets if isinstance(asset, dict) and _video_asset_url(asset)],
            key=lambda asset: (
                _video_asset_sort_start(asset),
                str(asset.get("created_at") or asset.get("updated_at") or ""),
            ),
        )
        for fallback_order, asset in enumerate(sorted_assets, start=1):
            metadata = (asset or {}).get("metadata") or {}
            storyboard_meta = metadata.get("storyboard") or {}
            if not isinstance(storyboard_meta, dict):
                storyboard_meta = {}
            asset_run_id = str(storyboard_meta.get("storyboardRunId") or storyboard_meta.get("runId") or "").strip()
            if asset_run_id and asset_run_id != storyboard_run_id:
                continue
            clip_idx = _infer_video_clip_index(asset, fallback_order)
            if not clip_idx or clip_idx > len(clips):
                continue
            if asset_run_id == storyboard_run_id:
                found[int(clip_idx)] = asset
            elif int(clip_idx) not in legacy_found:
                legacy_found[int(clip_idx)] = asset
        for clip_idx, asset in legacy_found.items():
            found.setdefault(clip_idx, asset)
        return found

    existing_aligned_keyframes = _existing_aligned_keyframes() if resume else {}
    existing_aligned_videos = _existing_aligned_videos() if resume else {}

    keyframes_by_shot: dict[int, str] = {}
    flf_first_by_shot: dict[int, str] = {}
    flf_last_by_shot: dict[int, str] = {}
    last_flf_last_url: Optional[str] = None

    generated_images: list[str] = []
    generated_videos: list[str] = []
    available_video_urls_by_clip: dict[int, str] = {}
    clip_context_by_index: dict[int, dict[str, Any]] = {}
    total_clip_count = len(clips)

    if resume:
        for clip_index, existing_asset in existing_aligned_videos.items():
            url = (((existing_asset or {}).get("content") or {}).get("videoUrl")) or (((existing_asset or {}).get("metadata") or {}).get("resourceUrl"))
            if not isinstance(url, str) or not url.strip():
                continue
            storyboard_meta = (((existing_asset or {}).get("metadata") or {}).get("storyboard") or {})
            try:
                existing_clip_attempt = int(storyboard_meta.get("clipAttempt") or 0)
            except Exception:
                existing_clip_attempt = 0
            if existing_clip_attempt > 0:
                clip_attempts_by_index[int(clip_index)] = max(
                    int(clip_attempts_by_index.get(int(clip_index), 0) or 0),
                    existing_clip_attempt,
                )
            available_video_urls_by_clip[int(clip_index)] = url.strip()
            clip_context_by_index[int(clip_index)] = {
                "public_url": url.strip(),
                "provider_video_url": (((existing_asset or {}).get("metadata") or {}).get("storyboard") or {}).get("providerVideoUrl")
                or (((existing_asset or {}).get("metadata") or {}).get("providerVideoUrl"))
                or (((existing_asset or {}).get("metadata") or {}).get("sourceProviderVideoUrl")),
                "world_refs": storyboard_meta.get("worldRefs") or [],
                "primary_world_ref": storyboard_meta.get("primaryWorldRef"),
                "shot_index": storyboard_meta.get("shotIndex"),
            }

    pending_clip_indexes = [
        int(clip.get("clipIndex") or 0)
        for clip in clips
        if int(clip.get("clipIndex") or 0) and int(clip.get("clipIndex") or 0) not in available_video_urls_by_clip
    ]
    if resume:
        log_runtime_event(
            "storyboard.resume.timeline_reconciled",
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
            requested_phase=requested_phase_norm,
            existing_video_clip_indexes=sorted(int(idx) for idx in available_video_urls_by_clip.keys()),
            pending_clip_indexes=pending_clip_indexes,
            next_clip_index=pending_clip_indexes[0] if pending_clip_indexes else None,
            total_clip_count=total_clip_count,
        )
    if resume and requested_phase_norm in {"all", "videos", "video"}:
        run_videos = bool(pending_clip_indexes)

    total_world_element_count = sum(
        1
        for element in _extract_world_elements(storyboard)
        if isinstance(element, dict)
        and str(element.get("image_prompt_en") or "").strip()
        and _element_supports_world_video(element)
    )
    completed_world_video_count = len(world_video_refs_by_id)
    completed_script_segment_count = sum(
        1
        for asset in existing_script_assets
        if isinstance(asset, dict) and str(((asset.get("metadata") or {}).get("kind") or "")).strip() == "script_segment"
    )
    completed_keyframe_count = len(existing_aligned_keyframes)
    total_expected_keyframe_assets = 0
    for clip in clips:
        mode = str(clip.get("mode") or "")
        total_expected_keyframe_assets += 1 if mode == "image_to_video" else 2

    inferred_phase_norm = requested_phase_norm
    if resume and requested_phase_norm in {"videos", "video"}:
        inferred_phase_norm = "videos" if pending_clip_indexes else "finalize"
    elif resume and requested_phase_norm == "all":
        if total_world_element_count > 0 and completed_world_video_count < total_world_element_count:
            inferred_phase_norm = "all"
        elif total_expected_keyframe_assets > 0 and completed_keyframe_count < total_expected_keyframe_assets:
            inferred_phase_norm = "all"
        elif pending_clip_indexes:
            inferred_phase_norm = "videos"
        else:
            inferred_phase_norm = "finalize"
    elif resume and requested_phase_norm == "cancelled":
        if total_world_element_count > 0 and completed_world_video_count < total_world_element_count:
            inferred_phase_norm = "all"
        elif total_expected_keyframe_assets > 0 and completed_keyframe_count < total_expected_keyframe_assets:
            inferred_phase_norm = "all"
        elif pending_clip_indexes:
            inferred_phase_norm = "videos"
        else:
            inferred_phase_norm = "finalize"

    phase_norm = inferred_phase_norm
    run_keyframes = phase_norm in {"keyframes", "keyframe"}
    run_videos = phase_norm in {"all", "videos", "video"} and bool(pending_clip_indexes)

    # Keep image metadata so we can duplicate frames (same URL) as separate timeline assets.
    image_meta_by_url: dict[str, dict[str, Any]] = {}

    def _new_tool_call_id() -> str:
        return f"call_{uuid.uuid4().hex}"

    async def _emit_executor_progress(update: str) -> None:
        if not user_id:
            return
        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {"type": "tool_call_progress", "tool_call_id": tool_call_id, "update": update},
        )

    async def _emit_tool_call_card(*, name: str, args: dict[str, Any]) -> str:
        tool_call_id = _new_tool_call_id()
        args_str = json.dumps(args or {}, ensure_ascii=False, indent=2)

        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {"type": "tool_call", "id": tool_call_id, "name": name, "arguments": args_str},
        )
        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {"type": "tool_call_arguments", "id": tool_call_id, "text": args_str},
        )

        # Persist for share/replay (DB stores role='assistant', but content keeps OpenAI structure).
        await create_chat_message(
            session_id=session_id,
            role="assistant",
            user_id=user_id,
            content={
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": tool_call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": args_str},
                    }
                ],
            },
        )
        return tool_call_id

    async def _emit_tool_result_card(*, tool_call_id: str, name: str, content: str) -> None:
        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {"type": "tool_result", "tool_call_id": tool_call_id, "content": content},
        )
        await create_chat_message(
            session_id=session_id,
            role="tool",
            user_id=user_id,
            content={"role": "tool", "tool_call_id": tool_call_id, "content": content, "name": name},
        )

    def _next_pending_clip_index() -> Optional[int]:
        for clip in clips:
            clip_index = int(clip.get("clipIndex") or 0)
            if clip_index and clip_index not in available_video_urls_by_clip:
                return clip_index
        return None

    def _resume_reconciliation_snapshot() -> dict[str, Any]:
        return {
            "requestedPhase": requested_phase_norm,
            "resolvedPhase": phase_norm,
            "resume": bool(resume),
            "scriptSegmentsCompleted": completed_script_segment_count,
            "scriptSegmentsExpected": total_clip_count,
            "worldVideosCompleted": completed_world_video_count,
            "worldVideosExpected": total_world_element_count,
            "keyframesCompleted": completed_keyframe_count,
            "keyframesExpected": total_expected_keyframe_assets,
            "videosCompleted": len(available_video_urls_by_clip),
            "videosExpected": total_clip_count,
            "existingVideoClipIndexes": sorted(int(idx) for idx in available_video_urls_by_clip.keys()),
            "pendingClipIndexes": pending_clip_indexes,
            "nextClipIndex": _next_pending_clip_index(),
        }

    def _build_storyboard_resume_state(
        *,
        status: str,
        phase_name: str,
        failed_clip_index: Optional[int] = None,
        failure_message: Optional[str] = None,
    ) -> dict[str, Any]:
        completed_clip_indexes = sorted(int(idx) for idx in available_video_urls_by_clip.keys() if isinstance(idx, int))
        storyboard_payload = json.dumps(storyboard, ensure_ascii=False, sort_keys=True)
        resume_phase = "videos" if str(phase_name or "").strip() in {"videos", "video"} else str(phase_name or "").strip()
        return {
            "type": "storyboard_resume_state",
            "schemaVersion": 1,
            "resumeTool": "execute_storyboard",
            "resumeArgs": {"resume": True, "phase": resume_phase or "videos", "storyboard_json": storyboard_payload},
            "status": str(status or "").strip(),
            "phase": str(phase_name or "").strip(),
            "runId": storyboard_run_id,
            "storyboardRunId": storyboard_run_id,
            "sessionId": str(session_id or "").strip(),
            "canvasId": str(canvas_id or "").strip(),
            "storyboardFingerprint": str(storyboard_fp or "").strip(),
            "storyboard": storyboard,
            "clipAttempts": {str(int(idx)): int(attempt) for idx, attempt in sorted(clip_attempts_by_index.items())},
            "aspectRatio": str(aspect_ratio or "").strip(),
            "clipCount": int(total_clip_count or 0),
            "completedClipCount": len(completed_clip_indexes),
            "completedClipIndexes": completed_clip_indexes[-12:],
            "nextClipIndex": _next_pending_clip_index(),
            "resumeReconciliation": _resume_reconciliation_snapshot(),
            "failedClipIndex": int(failed_clip_index) if isinstance(failed_clip_index, int) else None,
            "failureMessage": str(failure_message or "").strip() or None,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

    async def _persist_storyboard_resume_state(
        *,
        status: str,
        phase_name: str,
        failed_clip_index: Optional[int] = None,
        failure_message: Optional[str] = None,
    ) -> None:
        snapshot = _build_storyboard_resume_state(
            status=status,
            phase_name=phase_name,
            failed_clip_index=failed_clip_index,
            failure_message=failure_message,
        )
        await create_chat_message(
            session_id=session_id,
            role="assistant",
            user_id=user_id,
            content={
                "role": "assistant",
                "content": "<hide_in_user_ui> Storyboard resume state updated.</hide_in_user_ui>",
                "metadata": {"storyboard_resume_state": snapshot},
            },
        )

    async def _ensure_continuity_tail_world_asset(
        *,
        clip_index: int,
        shot_index: int,
        source_video_url: str,
        source_download_url: Optional[str],
        world_refs: list[str],
        primary_world_ref: Optional[str],
        required: bool = True,
    ) -> Optional[dict[str, Any]]:
        existing_ref = available_continuity_tail_refs_by_clip.get(clip_index)
        if isinstance(existing_ref, dict):
            preferred_video_url = str(existing_ref.get("preferred_video_url") or "").strip()
            if preferred_video_url:
                return existing_ref

        source_url = str(source_video_url or "").strip()
        if not source_url:
            if required:
                raise ValueError(f"missing source video url for continuity tail clip {clip_index}")
            return None

        temp_dir = tempfile.mkdtemp(prefix=f"reelmind_cont_tail_{clip_index:03d}_")
        source_path = os.path.join(temp_dir, f"clip_{clip_index:03d}_source.mp4")
        tail_path = os.path.join(temp_dir, f"clip_{clip_index:03d}_tail.mp4")
        try:
            downloaded_from_url = await _download_remote_video_with_fallback(
                [str(source_download_url or "").strip(), source_url],
                source_path,
            )
            actual_tail_duration = _extract_video_tail_clip(
                source_path,
                tail_path,
                tail_seconds=CONTINUITY_TAIL_DURATION_SECONDS,
            )
            filename = f"storyboard-{storyboard_fp[:12]}-clip-{clip_index:03d}-tail.mp4"
            mime_type, tail_public_url = await _upload_local_video_to_r2(
                tail_path,
                filename=filename,
                user_id=user_id,
            )

            continuity_ref = {
                "source_clip_index": clip_index,
                "source_shot_index": shot_index,
                "preferred_video_url": tail_public_url,
                "public_video_url": tail_public_url,
                "poster_url": tail_public_url,
                "duration_seconds": actual_tail_duration,
                "source_public_video_url": source_url,
                "source_download_url": downloaded_from_url,
                "source_type": "tail",
                "reference_kind": "连续性尾段参考",
                "name": f"Clip {clip_index} continuity tail",
                "mime_type": mime_type,
            }
            available_continuity_tail_refs_by_clip[clip_index] = continuity_ref

            continuity_asset_id = f"world-continuity-{storyboard_fp[:12]}-{clip_index:03d}"
            if continuity_asset_id not in existing_world_asset_ids:
                start_time = float(world_track_cursor_holder["value"])
                world_track_cursor_holder["value"] = start_time + actual_tail_duration
                continuity_asset = create_world_asset(
                    asset_id=continuity_asset_id,
                    code=f"CONT_CLIP_{clip_index:03d}",
                    name=f"Clip {clip_index} continuity tail",
                    description=f"Last {actual_tail_duration:.1f}s continuity bridge extracted from formal clip {clip_index}.",
                    duration=actual_tail_duration,
                    start_time=start_time,
                    video_url=tail_public_url,
                    thumbnail_url=tail_public_url,
                    metadata={
                        "kind": "clip_continuity_tail",
                        "isContinuityTail": True,
                        "runId": storyboard_run_id,
                        "storyboardRunId": storyboard_run_id,
                        "storyboardFingerprint": storyboard_fp,
                        "name": f"Clip {clip_index} continuity tail",
                        "sourceClipIndex": clip_index,
                        "sourceShotIndex": shot_index,
                        "sourcePublicVideoUrl": source_url,
                        "sourceDownloadUrl": downloaded_from_url,
                        "publicVideoUrl": tail_public_url,
                        "resourceUrl": tail_public_url,
                        "tailDurationSeconds": actual_tail_duration,
                        "worldRefs": list(world_refs),
                        "primaryWorldRef": primary_world_ref,
                        "mimeType": mime_type,
                    },
                )
                ok = await api_client_service.add_timeline_asset(
                    canvas_id=canvas_id,
                    asset_type="world",
                    asset_data=continuity_asset,
                    user_id=user_id,
                )
                if not ok:
                    raise ValueError(f"failed to persist continuity tail asset for clip {clip_index}")
                existing_world_asset_ids.add(continuity_asset_id)
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {
                        "type": "image_generated",
                        "asset": continuity_asset,
                        "image_url": tail_public_url,
                        "video_url": tail_public_url,
                        "source": "execute_storyboard",
                        "tool_name": "continuity_tail",
                    },
                )
                review_event = build_review_event_from_asset(continuity_asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)

            return continuity_ref
        except Exception as exc:
            if required:
                raise ValueError(f"continuity tail generation failed for clip {clip_index}: {exc}") from exc
            print(f"⚠️ continuity tail prewarm skipped for clip {clip_index}: {exc}")
            return None
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def _maybe_wait_for_video_gate(
        *,
        logical_batch_index: int,
        total_batches: int,
        clip_batch: list[dict[str, Any]],
        timeout_seconds: int,
    ) -> None:
        if not clip_batch:
            return
        gate_payload = {
            "batchIndex": logical_batch_index,
            "totalBatches": total_batches,
            "clipCount": len(clip_batch),
            "timeoutSeconds": timeout_seconds,
            "requestedAt": datetime.now(timezone.utc).isoformat(),
        }
        prepare_video_gate(session_id, gate_payload)
        await api_client_service._make_request(
            'POST',
            f'/chat/internal/session/{session_id}/video-gate/request',
            data={
                "batch_index": logical_batch_index,
                "total_batches": total_batches,
                "clip_count": len(clip_batch),
                "timeout_seconds": timeout_seconds,
            },
        )
        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {
                "type": "info",
                "info": "video_gate_pending",
                "data": gate_payload,
            },
        )
        gate_result = await wait_for_video_gate(session_id, timeout_seconds)
        clear_video_gate(session_id)
        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {
                "type": "info",
                "info": "video_gate_started" if gate_result == "approved" else "video_gate_auto_started",
                "data": {"batchIndex": logical_batch_index},
            },
        )

    await _persist_storyboard_resume_state(status="running", phase_name="bootstrap")

    async def _generate_video_clip(clip: dict[str, Any]) -> VideoGenerationResult:
        clip_index = int(clip["clipIndex"])
        shot_index = int(clip["shotIndex"])
        planned_mode = str(clip["mode"])
        execution_mode = str(clip.get("executionMode") or planned_mode)
        shot = shots_by_index.get(shot_index) or {}
        prev_shot = shots_by_index.get(shot_index - 1) or {}
        next_shot = shots_by_index.get(shot_index + 1) or {}
        prompt = str(clip["prompt"] or "")
        raw_world_refs = clip.get("worldRefs") or []
        primary_world_ref = str(clip.get("primaryWorldRef") or shot.get("video_primary_world_ref") or "").strip()
        required_world_ref_ids = _required_world_video_ref_ids_for_shot(
            list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            primary_world_ref,
            world_map,
        )
        continuity_ref = _select_preferred_continuity_reference_video(
            clip_index=clip_index,
            shot_index=shot_index,
            shot=shot,
            primary_world_ref=primary_world_ref,
            raw_world_refs=list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            available_continuity_tail_refs_by_clip=available_continuity_tail_refs_by_clip,
            available_video_urls_by_clip=available_video_urls_by_clip,
            clip_context_by_index=clip_context_by_index,
        )
        continuity_reference_video_url = (
            str(continuity_ref.get("preferred_video_url") or "").strip()
            if isinstance(continuity_ref, dict)
            else ""
        )
        continuity_duration_seconds = (
            float(continuity_ref.get("duration_seconds") or 0.0)
            if isinstance(continuity_ref, dict)
            else 0.0
        )
        world_video_budget_seconds = max(0.0, MAX_REFERENCE_VIDEO_TOTAL_SECONDS - continuity_duration_seconds)
        remaining_world_ref_slots = max(0, MAX_FORMAL_VIDEO_INPUTS - (1 if continuity_reference_video_url else 0))
        selected_world_video_refs = _select_world_reference_videos_for_shot(
            list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            primary_world_ref,
            world_map,
            world_video_refs_by_id,
            max_total_seconds=world_video_budget_seconds if continuity_reference_video_url else WORLD_ASSET_VIDEO_BUDGET_SECONDS,
            max_videos=remaining_world_ref_slots if continuity_reference_video_url else MAX_FORMAL_VIDEO_INPUTS,
        )
        selected_world_image_urls = _select_world_reference_image_urls_for_shot(
            list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            primary_world_ref,
            world_images_by_id,
            max_images=MAX_FORMAL_VIDEO_REFERENCE_IMAGES,
        )
        reference_video_urls: list[str] = []
        if continuity_reference_video_url:
            reference_video_urls.append(continuity_reference_video_url)
        for ref_info in selected_world_video_refs:
            candidate_url = str(ref_info.get("preferred_video_url") or "").strip()
            if candidate_url and candidate_url not in reference_video_urls:
                reference_video_urls.append(candidate_url)
        if not reference_video_urls and uploaded_video_urls:
            reference_video_urls.extend(
                [url for url in uploaded_video_urls[:MAX_FORMAL_VIDEO_INPUTS] if isinstance(url, str) and url.strip()]
            )
        capped_reference_video_urls: list[str] = []
        accumulated_reference_seconds = 0.0
        for url in reference_video_urls:
            if not isinstance(url, str) or not url.strip() or url in capped_reference_video_urls:
                continue
            duration_seconds = continuity_duration_seconds if url == continuity_reference_video_url else WORLD_ASSET_REFERENCE_DURATION_SECONDS
            if accumulated_reference_seconds + float(duration_seconds or 0) > MAX_REFERENCE_VIDEO_TOTAL_SECONDS:
                continue
            capped_reference_video_urls.append(url)
            accumulated_reference_seconds += float(duration_seconds or 0)
            if len(capped_reference_video_urls) >= MAX_FORMAL_VIDEO_INPUTS:
                break
        reference_video_urls = capped_reference_video_urls
        using_continuity_video_ref = bool(continuity_reference_video_url)
        if required_world_ref_ids and not selected_world_video_refs and not selected_world_image_urls and not reference_video_urls and execution_mode != "text_to_video":
            raise ValueError(
                f"video generation failed: missing usable world/continuity references for clip {clip_index}: "
                + ", ".join(required_world_ref_ids[:6])
            )
        for idx, ref_info in enumerate(selected_world_video_refs, start=1):
            label_index = idx + (1 if using_continuity_video_ref else 0)
            ref_info["label"] = f"@视频{label_index}"

        prompt_world_refs = []
        if primary_world_ref:
            prompt_world_refs.append(primary_world_ref)
        if isinstance(raw_world_refs, list):
            prompt_world_refs.extend([wid for wid in raw_world_refs if isinstance(wid, str)])

        locked_prompt = _compose_locked_video_prompt(
            shot,
            world_map,
            prompt_world_refs,
            prompt,
            selected_world_video_refs=selected_world_video_refs,
            visual_bible=storyboard.get("visual_bible") or storyboard.get("visualBible") or {},
            global_audio=storyboard.get("audio") or {},
            prev_shot=prev_shot,
            next_shot=next_shot,
        )
        ordered_reference_block = _build_ordered_reference_prompt_block(
            video_urls=reference_video_urls,
            image_urls=selected_world_image_urls,
            video_refs=selected_world_video_refs,
            world_refs=list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            primary_world_ref=primary_world_ref,
            world_map=world_map,
            continuity_ref=continuity_ref if isinstance(continuity_ref, dict) else None,
        )
        if ordered_reference_block:
            locked_prompt = f"{ordered_reference_block} {locked_prompt}".strip()

        if not reference_video_urls:
            tc_id = await _emit_tool_call_card(
                name="generate_video",
                args={
                    "prompt": locked_prompt,
                    "input_images": selected_world_image_urls,
                    "duration": CANONICAL_DURATION_SECONDS,
                    "aspect_ratio": aspect_ratio,
                    "audio_urls": uploaded_audio_urls[:4] if uploaded_audio_urls else None,
                },
            )
            try:
                clip_attempt = _next_clip_attempt(clip_attempts_by_index, clip_index)
                stable_request_id = _stable_agent_request_id(
                    f"{storyboard_run_id}-clip-{clip_index:03d}-{execution_mode}-attempt-{clip_attempt:03d}"
                )
                mime_type, public_url, response_data = await vid_gen.generate(
                    prompt=locked_prompt,
                    image_urls=selected_world_image_urls,
                    input_image_url=selected_world_image_urls[0] if selected_world_image_urls else None,
                    duration=CANONICAL_DURATION_SECONDS,
                    aspect_ratio=aspect_ratio,
                    audio_urls=uploaded_audio_urls[:4] if uploaded_audio_urls else None,
                    user_id=user_id,
                    request_id=stable_request_id,
                    return_details=True,
                )
                provider_video_url = (
                    str(response_data.get("provider_video_url")).strip()
                    if isinstance(response_data, dict)
                    and isinstance(response_data.get("provider_video_url"), str)
                    and str(response_data.get("provider_video_url")).strip()
                    else None
                )
                request_attempts = int(response_data.get("request_attempts", 1) or 1) if isinstance(response_data, dict) else 1
                final_request_id = str(response_data.get("request_id") or stable_request_id) if isinstance(response_data, dict) else stable_request_id
                base_request_id = str(response_data.get("base_request_id") or stable_request_id) if isinstance(response_data, dict) else stable_request_id
                fresh_request_attempts = int(response_data.get("fresh_request_attempts", 1) or 1) if isinstance(response_data, dict) else 1
            except Exception as e:
                error_text = str(e) or type(e).__name__
                await _emit_tool_result_card(
                    tool_call_id=tc_id,
                    name="generate_video",
                    content=f"video generation failed: {error_text}",
                )
                raise

            await _emit_tool_result_card(
                tool_call_id=tc_id,
                name="generate_video",
                content=(
                    f"video generated successfully ![video_url: {public_url}]({public_url}) "
                    f"- Mode: {'image_to_video' if selected_world_image_urls else 'text_to_video'}, Duration: {CANONICAL_DURATION_SECONDS}, Aspect Ratio: {aspect_ratio}, "
                    f"RequestRetries: {max(0, request_attempts - 1)}"
                ),
            )

            return VideoGenerationResult(
                clip_index=clip_index,
                shot_index=shot_index,
                mode=execution_mode,
                public_url=public_url,
                mime_type=mime_type,
                prompt=locked_prompt,
                input_image_url=selected_world_image_urls[0] if selected_world_image_urls else None,
                provider_video_url=provider_video_url,
                reference_image_urls=selected_world_image_urls,
                reference_video_urls=[],
                last_frame_url=None,
                tool_name="generate_video",
                binding_lock=clip.get("bindingLock"),
                world_refs=list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
                primary_world_ref=primary_world_ref,
                voice_direction=str(shot.get("voice_direction") or ""),
                dialogue_lines=shot.get("dialogue_lines") or [],
                request_attempts=request_attempts,
                request_id=final_request_id,
                base_request_id=base_request_id,
                fresh_request_attempts=fresh_request_attempts,
                clip_attempt=clip_attempt,
            )

        if selected_world_video_refs:
            print(
                "🎬 Generating formal clip with world audition refs: "
                f"clip={clip_index} shot={shot_index} refs={reference_video_urls}"
            )
        elif using_continuity_video_ref:
            print(
                "🎬 Generating formal clip with prior video-track ref: "
                f"clip={clip_index} shot={shot_index} refs={reference_video_urls}"
            )
        if not reference_video_urls:
            raise ValueError(f"video generation failed: missing previous clip video for clip {clip_index}")

        continuation_prompt = (
            f"{VIDEO_CONTINUITY_PROMPT_PREFIX}{locked_prompt}".strip()
            if using_continuity_video_ref
            else locked_prompt
        )
        tc_id = await _emit_tool_call_card(
            name="generate_video",
            args={
                "prompt": continuation_prompt,
                "input_videos": reference_video_urls,
                "input_images": selected_world_image_urls,
                "duration": CANONICAL_DURATION_SECONDS,
                "aspect_ratio": aspect_ratio,
                "audio_urls": uploaded_audio_urls[:4] if uploaded_audio_urls else None,
            },
        )
        try:
            clip_attempt = _next_clip_attempt(clip_attempts_by_index, clip_index)
            stable_request_id = _stable_agent_request_id(
                f"{storyboard_run_id}-clip-{clip_index:03d}-{execution_mode}-attempt-{clip_attempt:03d}"
            )
            mime_type, public_url, response_data = await vid_gen.generate(
                prompt=continuation_prompt,
                image_urls=selected_world_image_urls,
                video_urls=reference_video_urls,
                duration=CANONICAL_DURATION_SECONDS,
                aspect_ratio=aspect_ratio,
                audio_urls=uploaded_audio_urls[:4] if uploaded_audio_urls else None,
                user_id=user_id,
                request_id=stable_request_id,
                return_details=True,
            )
            provider_video_url = (
                str(response_data.get("provider_video_url")).strip()
                if isinstance(response_data, dict)
                and isinstance(response_data.get("provider_video_url"), str)
                and str(response_data.get("provider_video_url")).strip()
                else None
            )
            request_attempts = int(response_data.get("request_attempts", 1) or 1) if isinstance(response_data, dict) else 1
            final_request_id = str(response_data.get("request_id") or stable_request_id) if isinstance(response_data, dict) else stable_request_id
            base_request_id = str(response_data.get("base_request_id") or stable_request_id) if isinstance(response_data, dict) else stable_request_id
            fresh_request_attempts = int(response_data.get("fresh_request_attempts", 1) or 1) if isinstance(response_data, dict) else 1
        except Exception as e:
            error_text = str(e) or type(e).__name__
            await _emit_tool_result_card(
                tool_call_id=tc_id,
                name="generate_video",
                content=f"video generation failed: {error_text}",
            )
            raise

        await _emit_tool_result_card(
            tool_call_id=tc_id,
            name="generate_video",
            content=(
                f"video generated successfully ![video_url: {public_url}]({public_url}) "
                f"- Mode: video_to_video, Duration: {CANONICAL_DURATION_SECONDS}, Aspect Ratio: {aspect_ratio}, "
                f"ReferenceVideos: {len(reference_video_urls)}, RequestRetries: {max(0, request_attempts - 1)}"
            ),
        )

        return VideoGenerationResult(
            clip_index=clip_index,
            shot_index=shot_index,
            mode="video_to_video",
            public_url=public_url,
            mime_type=mime_type,
            prompt=continuation_prompt,
            input_image_url=selected_world_image_urls[0] if selected_world_image_urls else None,
            provider_video_url=provider_video_url,
            reference_image_urls=selected_world_image_urls,
            reference_video_urls=reference_video_urls,
            last_frame_url=None,
            tool_name="generate_video",
            binding_lock=clip.get("bindingLock"),
            world_refs=list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            primary_world_ref=primary_world_ref,
            voice_direction=str(shot.get("voice_direction") or ""),
            dialogue_lines=shot.get("dialogue_lines") or [],
            request_attempts=request_attempts,
            request_id=final_request_id,
            base_request_id=base_request_id,
            fresh_request_attempts=fresh_request_attempts,
            clip_attempt=clip_attempt,
        )

    async def _add_world_track_assets() -> None:
        world = storyboard.get("world") or storyboard.get("bible") or {}
        elements: list[dict] = []
        if isinstance(world, dict):
            raw_elements = world.get("elements") or []
            if isinstance(raw_elements, list):
                elements = [e for e in raw_elements if isinstance(e, dict)]

        if not elements:
            return

        def _importance(el: dict) -> float:
            try:
                return float(el.get("importance") or 0)
            except Exception:
                return 0.0

        elements.sort(key=_importance, reverse=True)
        max_importance = _importance(elements[0]) if elements else 0.0

        current_time = float(world_track_cursor_holder["value"])
        world_jobs: list[dict[str, Any]] = []
        for idx, el in enumerate(elements[:WORLD_TRACK_MAX_ASSETS]):
            element_id = str(el.get("id") or f"element_{idx + 1}")
            safe_element_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", element_id)[:40]
            element_asset_id = f"world-{storyboard_fp[:12]}-{safe_element_id}"

            duration = WORLD_ASSET_REFERENCE_DURATION_SECONDS
            start_time = current_time
            current_time += duration

            if resume and element_asset_id in existing_world_video_ready_asset_ids:
                continue

            name = str(el.get("name") or element_id)
            kind = str(el.get("kind") or "")
            description = str(el.get("description") or "")
            prompt = str(el.get("image_prompt_en") or "")
            element_aspect_ratio = normalize_generation_aspect_ratio(
                str(el.get("aspect_ratio") or storyboard.get("aspect_ratio") or "3:4"),
                default="3:4",
            )

            if not prompt.strip() or not _element_supports_world_video(el):
                continue

            use_uploaded_identity_anchor = (
                user_wants_self_insert
                and bool(uploaded_image_urls)
                and bool(primary_user_character_id)
                and element_id == primary_user_character_id
                and _element_is_character(el)
            )
            base_prompt = _self_insert_world_prompt(prompt) if use_uploaded_identity_anchor else prompt
            generation_prompt = _build_world_asset_video_prompt(el, base_prompt)

            world_jobs.append(
                {
                    "idx": idx,
                    "el": el,
                    "element_id": element_id,
                    "element_asset_id": element_asset_id,
                    "name": name,
                    "kind": kind,
                    "description": description,
                    "duration": duration,
                    "start_time": start_time,
                    "element_aspect_ratio": element_aspect_ratio,
                    "use_uploaded_identity_anchor": use_uploaded_identity_anchor,
                    "generation_prompt": generation_prompt,
                    "base_prompt": base_prompt,
                    "allow_dialogue_audition": True,
                }
            )

        if not world_jobs:
            return

        world_generation_failures: list[str] = []

        async def _generate_world_job(job: dict[str, Any]) -> dict[str, Any]:
            use_uploaded_identity_anchor = bool(job["use_uploaded_identity_anchor"])
            generation_prompt = str(job["generation_prompt"])
            image_prompt = _build_world_asset_image_prompt(job["el"], str(job.get("base_prompt") or ""))
            element_aspect_ratio = str(job["element_aspect_ratio"])
            image_tc_id = await _emit_tool_call_card(
                name="generate_image",
                args={
                    "prompt": image_prompt,
                    "aspect_ratio": element_aspect_ratio,
                    "input_image": uploaded_image_urls[0] if use_uploaded_identity_anchor and uploaded_image_urls else None,
                },
            )
            try:
                image_mime_type, image_width, image_height, image_public_url = await img_gen.generate(
                    prompt=image_prompt,
                    model="",
                    aspect_ratio=element_aspect_ratio,
                    input_image=uploaded_image_urls[0] if use_uploaded_identity_anchor and uploaded_image_urls else None,
                    user_id=user_id,
                )
            except Exception as e:
                error_text = f"{type(e).__name__}: {str(e) or repr(e)}"
                await _emit_tool_result_card(
                    tool_call_id=image_tc_id,
                    name="generate_image",
                    content=f"image generation failed: {error_text}",
                )
                return {"ok": False, "job": job, "error": error_text, "tool_name": "generate_image"}
            await _emit_tool_result_card(
                tool_call_id=image_tc_id,
                name="generate_image",
                content=f"image generated successfully ![image_url: {image_public_url}]({image_public_url}) - Mode: world_asset_image",
            )
            image_only_world_asset = create_world_asset(
                asset_id=str(job["element_asset_id"]),
                code=str(job["element_id"]),
                name=str(job["name"]),
                description=str(job["description"]),
                duration=WORLD_ASSET_REFERENCE_DURATION_SECONDS,
                start_time=float(job["start_time"]),
                image_url=image_public_url,
                thumbnail_url=image_public_url,
                metadata={
                    "kind": "world_element_image",
                    "worldElement": True,
                    "runId": storyboard_run_id,
                    "storyboardRunId": storyboard_run_id,
                    "storyboardFingerprint": storyboard_fp,
                    "elementId": str(job["element_id"]),
                    "elementKind": str(job["kind"]),
                    "name": str(job["name"]),
                    "importance": job["el"].get("importance"),
                    "linkedShotIndexes": job["el"].get("linked_shot_indexes") or [],
                    "visualInvariants": job["el"].get("visual_invariants"),
                    "aestheticBinding": job["el"].get("aesthetic_binding"),
                    "designLanguage": job["el"].get("design_language"),
                    "paletteNotes": job["el"].get("palette_notes"),
                    "stagingNotes": job["el"].get("staging_notes"),
                    "tags": job["el"].get("tags") or [],
                    "voiceProfile": job["el"].get("voice_profile") or {},
                    "visualBible": visual_bible,
                    "imagePromptEn": image_prompt,
                    "basePromptEn": str(job.get("base_prompt") or ""),
                    "aspectRatio": element_aspect_ratio,
                    "resourceUrl": image_public_url,
                    "imageUrl": image_public_url,
                    "imageMimeType": image_mime_type,
                    "imageWidth": image_width,
                    "imageHeight": image_height,
                    "posterUrl": image_public_url,
                    "usedUploadedIdentityAnchor": use_uploaded_identity_anchor,
                    "uploadedIdentityImageUrls": uploaded_image_urls[:MAX_EDIT_INPUT_IMAGES] if use_uploaded_identity_anchor else [],
                    "worldAuditionStatus": "pending",
                    "mimeType": image_mime_type,
                },
            )
            image_persist_result = await api_client_service.add_timeline_asset_with_detail(
                canvas_id=canvas_id,
                asset_type="world",
                asset_data=image_only_world_asset,
                user_id=user_id,
            )
            image_persisted = bool(image_persist_result.get("ok"))
            if image_persisted:
                world_images_by_id[str(job["element_id"])] = image_public_url
                generated_images.append(image_public_url)
                existing_world_asset_ids.add(str(job["element_asset_id"]))
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {
                        "type": "image_generated",
                        "asset": image_only_world_asset,
                        "image_url": image_public_url,
                        "source": "execute_storyboard",
                        "tool_name": "generate_image",
                    },
                )
                review_event = build_review_event_from_asset(image_only_world_asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)
            else:
                persist_error = str(image_persist_result.get("error") or "unknown timeline persistence error")
                print(
                    "❌ Failed to persist world image asset to timeline: "
                    f"canvas={canvas_id} element={job.get('element_id')} error={persist_error}"
                )

            tc_id = await _emit_tool_call_card(
                name="generate_video",
                args={
                    "prompt": generation_prompt,
                    "aspect_ratio": element_aspect_ratio,
                    "duration": WORLD_ASSET_VIDEO_GENERATION_SECONDS,
                    "input_images": [image_public_url],
                },
            )
            try:
                result = await vid_gen.generate(
                    prompt=generation_prompt,
                    input_image_url=image_public_url,
                    image_urls=[image_public_url],
                    duration=WORLD_ASSET_VIDEO_GENERATION_SECONDS,
                    aspect_ratio=element_aspect_ratio,
                    user_id=user_id,
                    return_details=True,
                )
                mime_type, public_url, response_data = result
                provider_video_url = (
                    str(response_data.get("provider_video_url")).strip()
                    if isinstance(response_data, dict)
                    and isinstance(response_data.get("provider_video_url"), str)
                    and str(response_data.get("provider_video_url")).strip()
                    else None
                )
                request_attempts = int(response_data.get("request_attempts", 1) or 1) if isinstance(response_data, dict) else 1
            except Exception as e:
                if _element_is_character(job["el"]) and _is_audio_safety_block_error(e):
                    try:
                        generation_prompt = _build_world_asset_video_prompt(
                            job["el"],
                            str(job.get("base_prompt") or ""),
                            allow_dialogue_audition=False,
                        )
                        result = await vid_gen.generate(
                            prompt=generation_prompt,
                            input_image_url=image_public_url,
                            image_urls=[image_public_url],
                            duration=WORLD_ASSET_VIDEO_GENERATION_SECONDS,
                            aspect_ratio=element_aspect_ratio,
                            user_id=user_id,
                            return_details=True,
                        )
                        mime_type, public_url, response_data = result
                        provider_video_url = (
                            str(response_data.get("provider_video_url")).strip()
                            if isinstance(response_data, dict)
                            and isinstance(response_data.get("provider_video_url"), str)
                            and str(response_data.get("provider_video_url")).strip()
                            else None
                        )
                        request_attempts = int(response_data.get("request_attempts", 1) or 1) if isinstance(response_data, dict) else 1
                    except Exception as retry_error:
                        error_text = str(retry_error) or type(retry_error).__name__
                        await _emit_tool_result_card(
                            tool_call_id=tc_id,
                            name="generate_video",
                            content=f"video generation failed: {error_text}",
                        )
                        return {"ok": False, "job": job, "error": error_text, "tool_name": "generate_video"}
                else:
                    error_text = str(e) or type(e).__name__
                    await _emit_tool_result_card(
                        tool_call_id=tc_id, name="generate_video", content=f"video generation failed: {error_text}"
                    )
                    return {"ok": False, "job": job, "error": error_text, "tool_name": "generate_video"}

            await _emit_tool_result_card(
                tool_call_id=tc_id,
                name="generate_video",
                content=(
                    f"video generated successfully ![video_url: {public_url}]({public_url}) "
                    f"- Mode: world_asset_audition, Duration: {WORLD_ASSET_VIDEO_GENERATION_SECONDS}, "
                    f"RequestRetries: {max(0, int(request_attempts or 1) - 1)}"
                ),
            )
            return {
                "ok": True,
                "job": job,
                "tool_name": "generate_video",
                "mime_type": mime_type,
                "public_url": public_url,
                "provider_video_url": provider_video_url,
                "generation_prompt": generation_prompt,
                "image_prompt": image_prompt,
                "image_public_url": image_public_url,
                "image_mime_type": image_mime_type,
                "image_width": image_width,
                "image_height": image_height,
                "image_only_world_asset": image_only_world_asset,
                "image_persisted": image_persisted,
                "request_attempts": request_attempts,
            }

        for batch_start in range(0, len(world_jobs), MAX_PARALLEL_WORLD_GENERATIONS):
            job_batch = world_jobs[batch_start: batch_start + MAX_PARALLEL_WORLD_GENERATIONS]
            batch_results = await asyncio.gather(*[_generate_world_job(job) for job in job_batch])

            for result in batch_results:
                job = result["job"]
                if not result.get("ok"):
                    world_generation_failures.append(
                        f"{job.get('element_id')}: {result.get('error') or 'unknown world audition failure'}"
                    )
                    continue

                el = job["el"]
                element_id = str(job["element_id"])
                element_asset_id = str(job["element_asset_id"])
                name = str(job["name"])
                kind = str(job["kind"])
                description = str(job["description"])
                duration = float(job["duration"])
                start_time = float(job["start_time"])
                element_aspect_ratio = str(job["element_aspect_ratio"])
                generation_prompt = str(result.get("generation_prompt") or job["generation_prompt"])
                image_prompt = str(result.get("image_prompt") or "")
                use_uploaded_identity_anchor = bool(job["use_uploaded_identity_anchor"])
                mime_type = str(result["mime_type"])
                raw_public_url = str(result["public_url"])
                image_public_url = str(result.get("image_public_url") or "").strip()
                image_mime_type = str(result.get("image_mime_type") or "image/png")
                image_width = result.get("image_width")
                image_height = result.get("image_height")
                image_persisted = bool(result.get("image_persisted"))
                provider_video_url = (
                    str(result["provider_video_url"]).strip()
                    if isinstance(result.get("provider_video_url"), str) and str(result["provider_video_url"]).strip()
                    else None
                )
                tool_name = str(result["tool_name"])
                preferred_video_url = provider_video_url or raw_public_url
                poster_url = image_public_url or raw_public_url
                if image_public_url and not image_persisted:
                    world_images_by_id[element_id] = image_public_url
                    generated_images.append(image_public_url)
                world_video_refs_by_id[element_id] = {
                    "element_id": element_id,
                    "name": name,
                    "reference_kind": _world_video_reference_kind_label(el),
                    "label": "",
                    "preferred_video_url": preferred_video_url,
                    "public_video_url": raw_public_url,
                    "provider_video_url": provider_video_url,
                    "poster_url": poster_url,
                    "duration_seconds": WORLD_ASSET_REFERENCE_DURATION_SECONDS,
                    "source_public_video_url": raw_public_url,
                }

                world_asset = create_world_asset(
                    asset_id=element_asset_id,
                    code=element_id,
                    name=name,
                    description=description,
                    duration=WORLD_ASSET_REFERENCE_DURATION_SECONDS,
                    start_time=start_time,
                    image_url=image_public_url or None,
                    video_url=raw_public_url,
                    thumbnail_url=poster_url,
                    metadata={
                        "kind": "world_element_video",
                        "worldElement": True,
                        "runId": storyboard_run_id,
                        "storyboardRunId": storyboard_run_id,
                        "storyboardFingerprint": storyboard_fp,
                        "elementId": element_id,
                        "elementKind": kind,
                        "name": name,
                        "importance": el.get("importance"),
                        "linkedShotIndexes": el.get("linked_shot_indexes") or [],
                        "visualInvariants": el.get("visual_invariants"),
                        "aestheticBinding": el.get("aesthetic_binding"),
                        "designLanguage": el.get("design_language"),
                        "paletteNotes": el.get("palette_notes"),
                        "stagingNotes": el.get("staging_notes"),
                        "tags": el.get("tags") or [],
                        "voiceProfile": el.get("voice_profile") or {},
                        "visualBible": visual_bible,
                        "imagePromptEn": image_prompt,
                        "videoPromptEn": generation_prompt,
                        "basePromptEn": str(job.get("base_prompt") or ""),
                        "aspectRatio": element_aspect_ratio,
                        "resourceUrl": raw_public_url,
                        "imageUrl": image_public_url,
                        "imageMimeType": image_mime_type,
                        "imageWidth": image_width,
                        "imageHeight": image_height,
                        "publicVideoUrl": raw_public_url,
                        "generationDurationSeconds": WORLD_ASSET_VIDEO_GENERATION_SECONDS,
                        "sourcePublicVideoUrl": raw_public_url,
                        "sourceProviderVideoUrl": provider_video_url,
                        "providerVideoUrl": provider_video_url,
                        "preferredProviderVideoUrl": provider_video_url or raw_public_url,
                        "posterUrl": poster_url,
                        "usedUploadedIdentityAnchor": use_uploaded_identity_anchor,
                        "uploadedIdentityImageUrls": uploaded_image_urls[:MAX_EDIT_INPUT_IMAGES] if use_uploaded_identity_anchor else [],
                        "mimeType": mime_type,
                    },
                )
                if image_persisted:
                    persist_result = await api_client_service.update_timeline_asset_with_detail(
                        canvas_id=canvas_id,
                        asset_id=element_asset_id,
                        properties={
                            "content": world_asset.get("content"),
                            "metadata": world_asset.get("metadata"),
                            "duration": world_asset.get("duration"),
                        },
                        user_id=user_id,
                    )
                    if not persist_result.get("ok"):
                        fallback_reason = str(persist_result.get("error") or "timeline asset update failed")
                        print(
                            "⚠️ World asset timeline update failed; retrying as add: "
                            f"canvas={canvas_id} element={element_id} error={fallback_reason}"
                        )
                        persist_result = await api_client_service.add_timeline_asset_with_detail(
                            canvas_id=canvas_id, asset_type="world", asset_data=world_asset, user_id=user_id
                        )
                else:
                    persist_result = await api_client_service.add_timeline_asset_with_detail(
                        canvas_id=canvas_id, asset_type="world", asset_data=world_asset, user_id=user_id
                    )
                if not persist_result.get("ok"):
                    persist_error = str(persist_result.get("error") or "unknown timeline persistence error")
                    print(
                        "❌ Failed to persist/update world asset to timeline: "
                        f"canvas={canvas_id} element={element_id} error={persist_error}"
                    )
                    await send_session_update(
                        user_id,
                        session_id,
                        canvas_id,
                        {
                            "type": "error",
                            "error": f"Failed to add world element asset to timeline: {persist_error[:500]}",
                        },
                    )
                else:
                    print(
                        "✅ World asset updated in timeline: "
                        f"canvas={canvas_id} element={element_id} video={raw_public_url} "
                        f"source_provider={provider_video_url or 'none'}"
                    )
                    existing_world_asset_ids.add(element_asset_id)
                    existing_world_video_ready_asset_ids.add(element_asset_id)
                    await send_session_update(
                        user_id,
                        session_id,
                        canvas_id,
                        {
                            "type": "image_generated",
                            "asset": world_asset,
                            "image_url": image_public_url or poster_url,
                            "video_url": raw_public_url,
                            "source": "execute_storyboard",
                            "tool_name": tool_name,
                        },
                    )
                    review_event = build_review_event_from_asset(world_asset)
                    if review_event:
                        await send_session_update(user_id, session_id, canvas_id, review_event)

        world_track_cursor_holder["value"] = max(float(world_track_cursor_holder["value"]), current_time)

        if world_generation_failures:
            failure_preview = " | ".join(world_generation_failures[:MAX_VIDEO_FAILURES_IN_MESSAGE])
            print(f"⚠️ World asset audition generation degraded: {failure_preview}")
            await send_session_update(
                user_id,
                session_id,
                canvas_id,
                {
                    "type": "info",
                    "message": "Some world audition videos failed. NolanX will continue with available refs and uploaded fallback media.",
                    "source": "execute_storyboard",
                    "phase": "world_track",
                    "failures": world_generation_failures[:MAX_VIDEO_FAILURES_IN_MESSAGE],
                },
            )

    async def _add_script_track_assets() -> None:
        added_any_script_assets = False

        shots = storyboard.get("shots") or []
        clips_count = len(clips) if clips else len(shots)
        main_duration_seconds = float(clips_count * CANONICAL_DURATION_SECONDS) if clips_count > 0 else 0.0

        screenplay = storyboard.get("screenplay") or {}
        if isinstance(screenplay, str):
            screenplay = {"language": "", "text": screenplay}

        screenplay_text = ""
        screenplay_language = ""
        screenplay_summary = ""
        if isinstance(screenplay, dict):
            screenplay_text = str(screenplay.get("text") or "")
            screenplay_language = str(screenplay.get("language") or "")
            screenplay_summary = str(screenplay.get("summary") or "")

        screenplay_asset_id = f"script-screenplay-{storyboard_fp[:12]}"
        if screenplay_asset_id not in existing_script_asset_ids and (screenplay_text or screenplay_summary):
            screenplay_asset = create_script_asset(
                asset_id=screenplay_asset_id,
                title=str(storyboard.get("title") or "Screenplay"),
                text=screenplay_text or screenplay_summary,
                duration=0.5,
                start_time=main_duration_seconds,
                metadata={
                    "kind": "screenplay",
                    "runId": storyboard_run_id,
                    "storyboardRunId": storyboard_run_id,
                    "storyboardFingerprint": storyboard_fp,
                    "language": screenplay_language,
                    "summary": screenplay_summary,
                    "title": storyboard.get("title"),
                    "premise": storyboard.get("premise"),
                    "style": storyboard.get("style"),
                    "visualBible": visual_bible,
                    "mainDurationSeconds": main_duration_seconds,
                    "voiceCast": (storyboard.get("audio") or {}).get("voice_cast") or [],
                    "shots": [
                        {
                            "index": s.get("index"),
                            "start_sec": s.get("start_sec"),
                            "end_sec": s.get("end_sec"),
                            "duration_seconds": s.get("duration_seconds"),
                            "binding_lock": s.get("binding_lock"),
                            "shot_description": s.get("shot_description"),
                            "shot_size": s.get("shot_size"),
                            "character_action": s.get("character_action"),
                            "emotion": s.get("emotion"),
                            "scene_tag": s.get("scene_tag"),
                            "lighting_mood": s.get("lighting_mood"),
                            "aesthetic_notes": s.get("aesthetic_notes"),
                            "composition_notes": s.get("composition_notes"),
                            "camera_language": s.get("camera_language"),
                            "palette_notes": s.get("palette_notes"),
                            "dialogue": s.get("dialogue"),
                            "voice_direction": s.get("voice_direction"),
                            "sound_effects": s.get("sound_effects"),
                            "keyframe_notes": s.get("keyframe_notes"),
                            "world_refs": s.get("world_refs") or s.get("worldRefs") or [],
                            "video_primary_world_ref": s.get("video_primary_world_ref"),
                            "characters": s.get("characters") or [],
                            "locations": s.get("locations") or [],
                            "props": s.get("props") or [],
                            "dialogue_lines": s.get("dialogue_lines") or [],
                            "subshots": s.get("subshots") or [],
                        }
                        for s in shots
                        if isinstance(s, dict)
                    ],
                },
            )
            ok = await api_client_service.add_timeline_asset(
                canvas_id=canvas_id, asset_type="script", asset_data=screenplay_asset, user_id=user_id
            )
            if not ok:
                await send_session_update(
                    user_id, session_id, canvas_id, {"type": "error", "error": "Failed to add screenplay asset to timeline."}
                )
            else:
                existing_script_asset_ids.add(screenplay_asset_id)
                added_any_script_assets = True
                review_event = build_review_event_from_asset(screenplay_asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)

        raw_segments = storyboard.get("script_segments") or storyboard.get("scriptSegments") or []
        segments: list[dict] = []
        if isinstance(raw_segments, list):
            segments = [s for s in raw_segments if isinstance(s, dict)]

        segments_by_shot: dict[int, dict] = {}
        for seg in segments:
            raw_idx = seg.get("shot_index") or seg.get("shotIndex") or seg.get("index")
            if isinstance(raw_idx, (int, float)):
                segments_by_shot[int(raw_idx)] = seg

        shots_by_index: dict[int, dict] = {}
        for s in shots:
            if not isinstance(s, dict):
                continue
            raw_idx = s.get("index")
            if isinstance(raw_idx, (int, float)):
                shots_by_index[int(raw_idx)] = s

        for clip in clips:
            clip_index = int(clip["clipIndex"])
            shot_index = int(clip["shotIndex"])
            clip_start = (clip_index - 1) * CANONICAL_DURATION_SECONDS
            draft_asset_id = _draft_script_asset_id(shot_index)

            if draft_asset_id in existing_script_asset_ids:
                deleted = await api_client_service.delete_timeline_asset(
                    canvas_id=canvas_id,
                    asset_id=draft_asset_id,
                    user_id=user_id,
                )
                if deleted:
                    existing_script_asset_ids.discard(draft_asset_id)

            seg = segments_by_shot.get(shot_index) or {}
            seg_text = str(seg.get("text") or "")

            shot = shots_by_index.get(shot_index) or {}
            if not seg_text.strip():
                seg_text = str(shot.get("storyboard_prompt") or shot.get("shot_description") or shot.get("keyframe_notes") or "")

            raw_world_refs = seg.get("world_refs") or seg.get("worldRefs") or shot.get("world_refs") or shot.get("worldRefs") or []
            seg_world_refs: list[str] = []
            if isinstance(raw_world_refs, list):
                for r in raw_world_refs:
                    if isinstance(r, str) and r.strip():
                        seg_world_refs.append(r.strip())

            seg_asset_id = f"script-seg-{storyboard_fp[:12]}-{clip_index:03d}"
            if resume and seg_asset_id in existing_script_asset_ids:
                continue

            title = str(seg.get("title") or f"Clip {clip_index}")
            subshots = shot.get("subshots") or []
            subshot_summary = " | ".join(
                str(sub.get("beat_description") or "")
                for sub in subshots
                if isinstance(sub, dict) and str(sub.get("beat_description") or "").strip()
            )
            script_asset = create_script_asset(
                asset_id=seg_asset_id,
                title=title,
                text=seg_text,
                duration=CANONICAL_DURATION_SECONDS,
                start_time=clip_start,
                metadata={
                    "kind": "script_segment",
                    "runId": storyboard_run_id,
                    "storyboardRunId": storyboard_run_id,
                    "storyboardFingerprint": storyboard_fp,
                    "clipIndex": clip_index,
                    "shotIndex": shot_index,
                    "bindingLock": shot.get("binding_lock") or seg.get("binding_lock"),
                    "worldRefs": seg_world_refs,
                    "dialogue": shot.get("dialogue") or seg.get("dialogue"),
                    "voiceRefs": seg.get("voice_refs") or [],
                    "voiceDirection": shot.get("voice_direction"),
                    "aestheticNotes": shot.get("aesthetic_notes") or seg.get("aesthetic_notes"),
                    "visualStyleRef": seg.get("visual_style_ref"),
                    "compositionNotes": shot.get("composition_notes"),
                    "cameraLanguage": shot.get("camera_language"),
                    "paletteNotes": shot.get("palette_notes"),
                    "visualBibleStyleName": visual_bible.get("style_name"),
                    "soundEffects": shot.get("sound_effects") or seg.get("sound_effects"),
                    "shotDescription": shot.get("shot_description"),
                    "shotSize": shot.get("shot_size"),
                    "characterAction": shot.get("character_action"),
                    "emotion": shot.get("emotion"),
                    "sceneTag": shot.get("scene_tag"),
                    "lightingMood": shot.get("lighting_mood"),
                    "storyboardPrompt": shot.get("storyboard_prompt"),
                    "visualPromptEn": shot.get("visual_prompt_en"),
                    "motionPromptEn": shot.get("motion_prompt_en"),
                    "videoPrimaryWorldRef": shot.get("video_primary_world_ref"),
                    "characters": shot.get("characters") or [],
                    "locations": shot.get("locations") or [],
                    "props": shot.get("props") or [],
                    "dialogueLines": shot.get("dialogue_lines") or [],
                    "subshots": subshots,
                    "subshotSummary": subshot_summary,
                },
            )
            ok = await api_client_service.add_timeline_asset(
                canvas_id=canvas_id, asset_type="script", asset_data=script_asset, user_id=user_id
            )
            if not ok:
                await send_session_update(
                    user_id, session_id, canvas_id, {"type": "error", "error": "Failed to add script segment asset to timeline."}
                )
            else:
                existing_script_asset_ids.add(seg_asset_id)
                added_any_script_assets = True
                review_event = build_review_event_from_asset(script_asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)

        if added_any_script_assets:
            await send_session_update(
                user_id,
                session_id,
                canvas_id,
                {"type": "script_generated", "source": "execute_storyboard", "storyboardFingerprint": storyboard_fp},
            )

    def _remember_image_meta(url: str, *, width: int, height: int, mime_type: str, prompt: str) -> None:
        if not url:
            return
        if url in image_meta_by_url:
            return
        image_meta_by_url[url] = {"width": int(width), "height": int(height), "mime_type": mime_type, "prompt": prompt}

    def _get_meta_or_fallback(url: str) -> dict[str, Any]:
        meta = image_meta_by_url.get(url)
        if meta:
            return meta
        # Try to read from any existing aligned keyframe asset.
        for asset in existing_aligned_keyframes.values():
            content = (asset or {}).get("content") or {}
            if (content.get("imageUrl") == url) or ((asset or {}).get("metadata") or {}).get("resourceUrl") == url:
                return {
                    "width": int(content.get("width") or 0),
                    "height": int(content.get("height") or 0),
                    "mime_type": content.get("mimeType") or "image/jpeg",
                    "prompt": (content.get("description") or ""),
                }
        return {"width": 0, "height": 0, "mime_type": "image/jpeg", "prompt": ""}

    image_tool_by_url: dict[str, str] = {}

    run_pre_video_tracks = phase_norm in {"all", "world_track", "world", "script_track", "script", "keyframes", "keyframe"}
    if run_pre_video_tracks:
        try:
            delegated_script_phase = await _try_delegate_phase_to_acp(
                phase_name="script_writer",
                operation_default="prepare_storyboard_script_phase",
                payload={
                    "storyboard": storyboard,
                    "storyboard_json": storyboard_json,
                    "phase": "script_track",
                    "aspect_ratio": aspect_ratio,
                },
                session_id=session_id,
                canvas_id=canvas_id,
                user_id=user_id,
            )
            if delegated_script_phase:
                log_runtime_event("storyboard.phase.delegated", phase_name="script_writer", session_id=session_id, canvas_id=canvas_id, user_id=user_id)
        except Exception as exc:
            log_runtime_warning("storyboard.phase.delegation_failed_fallback_local", phase_name="script_writer", session_id=session_id, canvas_id=canvas_id, user_id=user_id, error=str(exc))

        await _emit_executor_progress(_executor_progress_message("script_track", preferred_language))
        await _add_script_track_assets()
        await _persist_storyboard_resume_state(status="running", phase_name="script_track")
        await _emit_executor_progress(_executor_progress_message("world_track", preferred_language))
        world_track_task = asyncio.create_task(_add_world_track_assets(), name=f"world-track-{session_id}")
        try:
            await asyncio.shield(world_track_task)
        except asyncio.CancelledError:
            world_track_task.cancel()
            await _persist_storyboard_resume_state(status="interrupted", phase_name="world_track")
            raise
        await _persist_storyboard_resume_state(status="running", phase_name="world_track")

    missing_world_refs_by_clip: list[str] = []
    for clip in clips:
        clip_index = int(clip.get("clipIndex") or 0)
        shot_index = int(clip.get("shotIndex") or 0)
        raw_world_refs = clip.get("worldRefs") or []
        primary_world_ref = str(clip.get("primaryWorldRef") or "").strip()
        required_ids = _required_world_video_ref_ids_for_shot(
            list(raw_world_refs) if isinstance(raw_world_refs, list) else [],
            primary_world_ref,
            world_map,
        )
        missing_ids = [element_id for element_id in required_ids if element_id not in world_video_refs_by_id]
        if missing_ids:
            missing_world_refs_by_clip.append(
                f"clip {clip_index} / shot {shot_index}: missing world refs {', '.join(missing_ids[:6])}"
            )

    if missing_world_refs_by_clip:
        print(
            "⚠️ Some world audition videos are missing; formal clip generation will continue "
            "with available world refs, continuity refs, and uploaded fallback media where possible: "
            + " | ".join(missing_world_refs_by_clip[:MAX_VIDEO_FAILURES_IN_MESSAGE])
        )

    # 1) Generate ALL *unique* keyframe images first (no timeline insertion yet).
    if run_keyframes:
        await _emit_executor_progress(_executor_progress_message("keyframes", preferred_language))
        for item in keyframe_plan:
            # Prefer aligned assets (clipIndex+role) for resume, then legacy (shotIndex+kind).
            clip_index = shot_to_clip_index.get(item.shot_index)
            role = "single" if item.kind == "single" else ("flf_first" if item.kind == "flf_first" else "flf_last")
            aligned_asset = existing_aligned_keyframes.get((clip_index or -1, role)) if clip_index else None
            if aligned_asset:
                md = (aligned_asset.get("metadata") or {})
                content = (aligned_asset.get("content") or {})
                url = content.get("imageUrl") or md.get("resourceUrl")
                if isinstance(url, str) and url:
                    _remember_image_meta(
                        url,
                        width=int(content.get("width") or 0),
                        height=int(content.get("height") or 0),
                        mime_type=content.get("mimeType") or "image/jpeg",
                        prompt=item.prompt,
                    )
                    keyframes_by_shot[item.shot_index] = url
                    if item.kind == "flf_first":
                        flf_first_by_shot[item.shot_index] = url
                        last_flf_last_url = None
                    elif item.kind == "flf_last":
                        flf_last_by_shot[item.shot_index] = url
                        last_flf_last_url = url
                    continue

            cached = existing_keyframes.get((item.shot_index, item.kind))
            if cached:
                url = cached
                keyframes_by_shot[item.shot_index] = url
                if item.kind == "flf_first":
                    flf_first_by_shot[item.shot_index] = url
                    last_flf_last_url = None
                elif item.kind == "flf_last":
                    flf_last_by_shot[item.shot_index] = url
                    last_flf_last_url = url
                continue

            ref_url = None
            if item.kind == "flf_last" and last_flf_last_url and item.ref_shot_index is None:
                ref_url = last_flf_last_url
            else:
                ref_url = _pick_ref_url_by_shot_index(keyframes_by_shot, item.ref_shot_index)

            # Collect multi-reference images for edit_image:
            # - primary: continuity keyframe (ref_url), if available
            # - secondary: world reference images (style/character/prop/location), in world_refs order
            ref_urls: list[str] = []
            if isinstance(ref_url, str) and ref_url:
                ref_urls.append(ref_url)

            if item.world_refs:
                for wid in item.world_refs:
                    candidate = world_images_by_id.get(wid)
                    if isinstance(candidate, str) and candidate:
                        ref_urls.append(candidate)

            # De-dup while preserving order
            seen_urls: set[str] = set()
            deduped_urls: list[str] = []
            for u in ref_urls:
                if not u or u in seen_urls:
                    continue
                seen_urls.add(u)
                deduped_urls.append(u)
            ref_urls = deduped_urls

            # If no continuity ref_url, but we have world references, promote the first world image as primary.
            if not ref_url and ref_urls:
                ref_url = ref_urls[0]

            # Ensure primary is first (and cap count).
            if ref_url and ref_urls:
                ref_urls = [ref_url] + [u for u in ref_urls if u != ref_url]
            if MAX_EDIT_INPUT_IMAGES > 0 and len(ref_urls) > MAX_EDIT_INPUT_IMAGES:
                ref_urls = ref_urls[:MAX_EDIT_INPUT_IMAGES]

            prompt = item.prompt
            used_tool_name = "generate_image"

            if item.method == "edit_image":
                if not ref_url:
                    tc_id = await _emit_tool_call_card(
                        name="generate_image", args={"prompt": prompt, "aspect_ratio": aspect_ratio, "input_image": None}
                    )
                    used_tool_name = "generate_image"
                    try:
                        mime_type, width, height, url = await img_gen.generate(
                            prompt=prompt,
                            model="",
                            aspect_ratio=aspect_ratio,
                            user_id=user_id,
                        )
                    except Exception as e:
                        await _emit_tool_result_card(
                            tool_call_id=tc_id,
                            name="generate_image",
                            content=f"image generation failed: {e}",
                        )
                        raise
                    await _emit_tool_result_card(
                        tool_call_id=tc_id,
                        name="generate_image",
                        content=f"image generated successfully ![image_url: {url}]({url})",
                    )
                else:
                    tc_id = await _emit_tool_call_card(
                        name="edit_image",
                        args={
                            "prompt": prompt,
                            "aspect_ratio": aspect_ratio,
                            "input_image": ref_url,
                            "input_images": ref_urls if len(ref_urls) > 1 else None,
                        },
                    )
                    used_tool_name = "edit_image"
                    try:
                        mime_type, width, height, url = await img_edit.edit(
                            prompt=prompt,
                            model="",
                            aspect_ratio=aspect_ratio,
                            input_image=ref_url,
                            input_images=ref_urls if len(ref_urls) > 1 else None,
                            user_id=user_id,
                        )
                    except Exception as e:
                        await _emit_tool_result_card(
                            tool_call_id=tc_id,
                            name="edit_image",
                            content=f"image edit failed: {e}",
                        )
                        raise
                    await _emit_tool_result_card(
                        tool_call_id=tc_id,
                        name="edit_image",
                        content=f"image edited successfully ![image_url: {url}]({url})",
                    )
            else:
                tc_id = await _emit_tool_call_card(
                    name="generate_image", args={"prompt": prompt, "aspect_ratio": aspect_ratio, "input_image": None}
                )
                used_tool_name = "generate_image"
                try:
                    mime_type, width, height, url = await img_gen.generate(
                        prompt=prompt,
                        model="",
                        aspect_ratio=aspect_ratio,
                        user_id=user_id,
                    )
                except Exception as e:
                    await _emit_tool_result_card(
                        tool_call_id=tc_id,
                        name="generate_image",
                        content=f"image generation failed: {e}",
                    )
                    raise
                await _emit_tool_result_card(
                    tool_call_id=tc_id,
                    name="generate_image",
                    content=f"image generated successfully ![image_url: {url}]({url})",
                )

            _remember_image_meta(url, width=width, height=height, mime_type=mime_type, prompt=prompt)
            generated_images.append(url)
            image_tool_by_url[url] = used_tool_name

            keyframes_by_shot[item.shot_index] = url
            if item.kind == "flf_first":
                flf_first_by_shot[item.shot_index] = url
                last_flf_last_url = None
            elif item.kind == "flf_last":
                flf_last_by_shot[item.shot_index] = url
                last_flf_last_url = url
    else:
        # videos-only phase: hydrate keyframe maps from existing assets.
        for (shot_idx, kind), url in existing_keyframes.items():
            keyframes_by_shot[shot_idx] = url
            if kind == "flf_first":
                flf_first_by_shot[shot_idx] = url
            elif kind == "flf_last":
                flf_last_by_shot[shot_idx] = url

    # Fill missing FLF first frames for consecutive runs (reuse previous last)
    for vp in video_plan:
        if vp.mode != "first_last_frame":
            continue
        if vp.shot_index not in flf_first_by_shot:
            # This happens for consecutive FLF segments where we skipped generating flf_first.
            # Reuse previous shot's flf_last as this first.
            prev_last = flf_last_by_shot.get(vp.shot_index - 1)
            if prev_last:
                flf_first_by_shot[vp.shot_index] = prev_last

    # 1.5) Insert aligned keyframes into the timeline so every clip has corresponding keyframes.
    # - image_to_video => one keyframe (8)
    # - first_last_frame => two keyframes (4 + 4), duplicating boundary frames for chained FLF
    if run_keyframes:
        for clip in clips:
            clip_index = int(clip["clipIndex"])
            shot_index = int(clip["shotIndex"])
            mode = str(clip["mode"])
            clip_start = (clip_index - 1) * CANONICAL_DURATION_SECONDS

            if mode == "image_to_video":
                url = keyframes_by_shot.get(shot_index)
                if not url:
                    continue
                if resume and existing_aligned_keyframes.get((clip_index, "single")):
                    continue
                meta = _get_meta_or_fallback(url)
                file_id = generate_file_id()
                asset = create_keyframe_asset(
                    file_id=file_id,
                    public_url=url,
                    width=int(meta.get("width") or 0),
                    height=int(meta.get("height") or 0),
                    mime_type=str(meta.get("mime_type") or "image/jpeg"),
                    prompt=str(meta.get("prompt") or ""),
                    duration=CANONICAL_DURATION_SECONDS,
                    start_time=clip_start,
                    storyboard={
                        "clipIndex": clip_index,
                        "shotIndex": shot_index,
                        "runId": storyboard_run_id,
                        "storyboardRunId": storyboard_run_id,
                        "mode": mode,
                        "role": "single",
                    },
                )
                ok = await api_client_service.add_timeline_asset(
                    canvas_id=canvas_id, asset_type="keyframe", asset_data=asset, user_id=user_id
                )
                if not ok:
                    await send_session_update(
                        user_id, session_id, canvas_id, {"type": "error", "error": "Failed to add keyframe asset to timeline."}
                    )
                tool_name = image_tool_by_url.get(url) or "generate_image"
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {"type": "image_generated", "asset": asset, "image_url": url, "source": "execute_storyboard", "tool_name": tool_name},
                )
                review_event = build_review_event_from_asset(asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)
                continue

            # FLF: two half-duration keyframes aligned to the full clip.
            first_url = flf_first_by_shot.get(shot_index)
            last_url = flf_last_by_shot.get(shot_index)
            if not first_url or not last_url:
                continue

            if not (resume and existing_aligned_keyframes.get((clip_index, "flf_first"))):
                first_meta = _get_meta_or_fallback(first_url)
                file_id = generate_file_id()
                first_asset = create_keyframe_asset(
                    file_id=file_id,
                    public_url=first_url,
                    width=int(first_meta.get("width") or 0),
                    height=int(first_meta.get("height") or 0),
                    mime_type=str(first_meta.get("mime_type") or "image/jpeg"),
                    prompt=str(first_meta.get("prompt") or ""),
                    duration=HALF_DURATION_SECONDS,
                    start_time=clip_start,
                    storyboard={
                        "clipIndex": clip_index,
                        "shotIndex": shot_index,
                        "runId": storyboard_run_id,
                        "storyboardRunId": storyboard_run_id,
                        "mode": mode,
                        "role": "flf_first",
                    },
                )
                ok = await api_client_service.add_timeline_asset(
                    canvas_id=canvas_id, asset_type="keyframe", asset_data=first_asset, user_id=user_id
                )
                if not ok:
                    await send_session_update(
                        user_id, session_id, canvas_id, {"type": "error", "error": "Failed to add FLF first keyframe to timeline."}
                    )
                tool_name = image_tool_by_url.get(first_url) or "generate_image"
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {
                        "type": "image_generated",
                        "asset": first_asset,
                        "image_url": first_url,
                        "source": "execute_storyboard",
                        "tool_name": tool_name,
                    },
                )
                review_event = build_review_event_from_asset(first_asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)

            if not (resume and existing_aligned_keyframes.get((clip_index, "flf_last"))):
                last_meta = _get_meta_or_fallback(last_url)
                file_id = generate_file_id()
                last_asset = create_keyframe_asset(
                    file_id=file_id,
                    public_url=last_url,
                    width=int(last_meta.get("width") or 0),
                    height=int(last_meta.get("height") or 0),
                    mime_type=str(last_meta.get("mime_type") or "image/jpeg"),
                    prompt=str(last_meta.get("prompt") or ""),
                    duration=HALF_DURATION_SECONDS,
                    start_time=clip_start + HALF_DURATION_SECONDS,
                    storyboard={
                        "clipIndex": clip_index,
                        "shotIndex": shot_index,
                        "runId": storyboard_run_id,
                        "storyboardRunId": storyboard_run_id,
                        "mode": mode,
                        "role": "flf_last",
                    },
                )
                ok = await api_client_service.add_timeline_asset(
                    canvas_id=canvas_id, asset_type="keyframe", asset_data=last_asset, user_id=user_id
                )
                if not ok:
                    await send_session_update(
                        user_id, session_id, canvas_id, {"type": "error", "error": "Failed to add FLF last keyframe to timeline."}
                    )
                tool_name = image_tool_by_url.get(last_url) or "edit_image"
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {
                        "type": "image_generated",
                        "asset": last_asset,
                        "image_url": last_url,
                        "source": "execute_storyboard",
                        "tool_name": tool_name,
                    },
                )
                review_event = build_review_event_from_asset(last_asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)

    await _persist_storyboard_resume_state(status="running", phase_name="videos")

    # 2) Generate videos after keyframes exist
    if run_videos:
        pending_video_clips: list[dict[str, Any]] = []
        for clip in clips:
            clip_index = int(clip["clipIndex"])
            if resume and existing_aligned_videos.get(clip_index):
                # Already present on the timeline; don't regenerate.
                existing_asset = existing_aligned_videos[clip_index]
                url = (((existing_asset or {}).get("content") or {}).get("videoUrl")) or (((existing_asset or {}).get("metadata") or {}).get("resourceUrl"))
                if isinstance(url, str) and url:
                    available_video_urls_by_clip[clip_index] = url
                    generated_videos.append(url)
                    storyboard_meta = (((existing_asset or {}).get("metadata") or {}).get("storyboard") or {})
                    clip_context_by_index[clip_index] = {
                        "public_url": url,
                        "provider_video_url": (((existing_asset or {}).get("metadata") or {}).get("storyboard") or {}).get("providerVideoUrl")
                        or (((existing_asset or {}).get("metadata") or {}).get("providerVideoUrl"))
                        or (((existing_asset or {}).get("metadata") or {}).get("sourceProviderVideoUrl")),
                        "world_refs": storyboard_meta.get("worldRefs") or [],
                        "primary_world_ref": storyboard_meta.get("primaryWorldRef"),
                        "shot_index": storyboard_meta.get("shotIndex"),
                    }
                continue
            pending_video_clips.append(clip)

        if pending_video_clips:
            max_pending_clip_index = max(int(clip["clipIndex"]) for clip in pending_video_clips)
            for existing_clip_index in sorted(available_video_urls_by_clip.keys()):
                if existing_clip_index >= max_pending_clip_index:
                    continue
                existing_source_url = str(available_video_urls_by_clip.get(existing_clip_index) or "").strip()
                if not existing_source_url or existing_clip_index in available_continuity_tail_refs_by_clip:
                    continue
                existing_context = clip_context_by_index.get(existing_clip_index) or {}
                await _ensure_continuity_tail_world_asset(
                    clip_index=existing_clip_index,
                    shot_index=int(existing_context.get("shot_index") or existing_clip_index),
                    source_video_url=existing_source_url,
                    source_download_url=str(existing_context.get("provider_video_url") or "").strip() or None,
                    world_refs=list(existing_context.get("world_refs") or []),
                    primary_world_ref=existing_context.get("primary_world_ref"),
                    required=False,
                )

            await _emit_executor_progress(
                _executor_progress_message(
                    "video_start",
                    preferred_language,
                    count=len(pending_video_clips),
                )
            )
            try:
                delegated_video_phase = await _try_delegate_phase_to_acp(
                    phase_name="video_designer",
                    operation_default="prepare_storyboard_video_phase",
                    payload={
                        "storyboard": storyboard,
                        "phase": "videos",
                        "aspect_ratio": aspect_ratio,
                        "video_plan_count": len(video_plan),
                    },
                    session_id=session_id,
                    canvas_id=canvas_id,
                    user_id=user_id,
                )
                if delegated_video_phase:
                    log_runtime_event("storyboard.phase.delegated", phase_name="video_designer", session_id=session_id, canvas_id=canvas_id, user_id=user_id)
            except Exception as exc:
                log_runtime_warning("storyboard.phase.delegation_failed_fallback_local", phase_name="video_designer", session_id=session_id, canvas_id=canvas_id, user_id=user_id, error=str(exc))

            video_failures: list[str] = []
            ordered_pending_clip_indexes = sorted(int(clip["clipIndex"]) for clip in pending_video_clips)
            ordered_pending_clips = sorted(pending_video_clips, key=lambda item: int(item["clipIndex"]))
            total_batches = max((((int(clip["clipIndex"]) - 1) // VIDEO_GENERATION_BATCH_SIZE) + 1) for clip in clips) if clips else 0
            completed_count = 0

            async def _persist_generated_video_result(result: VideoGenerationResult, clip: dict[str, Any]) -> None:
                available_video_urls_by_clip[result.clip_index] = result.public_url
                clip_context_by_index[result.clip_index] = {
                    "public_url": result.public_url,
                    "provider_video_url": result.provider_video_url,
                    "world_refs": list(result.world_refs),
                    "primary_world_ref": result.primary_world_ref,
                    "shot_index": result.shot_index,
                }
                clip_start = (result.clip_index - 1) * CANONICAL_DURATION_SECONDS
                asset = create_video_asset(
                    file_id=generate_file_id(),
                    public_url=result.public_url,
                    input_image_url=result.input_image_url,
                    aspect_ratio=aspect_ratio,
                    mime_type=result.mime_type,
                    prompt=result.prompt,
                    duration=CANONICAL_DURATION_SECONDS,
                    start_time=clip_start,
                    last_frame_url=result.last_frame_url,
                    reference_image_urls=result.reference_image_urls,
                    reference_video_urls=result.reference_video_urls,
                    generation_mode=result.mode,
                    storyboard={
                        "clipIndex": result.clip_index,
                        "shotIndex": result.shot_index,
                        "runId": storyboard_run_id,
                        "storyboardRunId": storyboard_run_id,
                        "scriptAssetId": f"script-seg-{storyboard_fp[:12]}-{result.clip_index:03d}",
                        "scriptClipIndex": result.clip_index,
                        "clipAttempt": result.clip_attempt,
                        "mode": result.mode,
                        "plannedMode": clip.get("mode"),
                        "bindingLock": result.binding_lock,
                        "worldRefs": result.world_refs,
                        "resolvedReferenceImageUrls": result.reference_image_urls,
                        "resolvedReferenceVideoUrls": result.reference_video_urls,
                        "primaryWorldRef": result.primary_world_ref,
                        "voiceDirection": result.voice_direction,
                        "dialogueLines": result.dialogue_lines,
                        "providerVideoUrl": result.provider_video_url,
                        "requestId": result.request_id,
                        "baseRequestId": result.base_request_id,
                        "freshRequestAttempts": result.fresh_request_attempts,
                        "requestAttempts": result.request_attempts,
                        "requestRetryCount": max(0, int(result.request_attempts or 1) - 1),
                        "visualBibleStyleName": visual_bible.get("style_name"),
                        "aestheticNotes": (shots_by_index.get(result.shot_index) or {}).get("aesthetic_notes"),
                        "compositionNotes": (shots_by_index.get(result.shot_index) or {}).get("composition_notes"),
                        "cameraLanguage": (shots_by_index.get(result.shot_index) or {}).get("camera_language"),
                        "paletteNotes": (shots_by_index.get(result.shot_index) or {}).get("palette_notes"),
                    },
                )
                ok = await api_client_service.add_timeline_asset(
                    canvas_id=canvas_id, asset_type="video", asset_data=asset, user_id=user_id
                )
                if not ok:
                    await send_session_update(
                        user_id,
                        session_id,
                        canvas_id,
                        {"type": "error", "error": "Failed to add video asset to timeline (internal API error)."},
                    )
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {
                        "type": "video_generated",
                        "asset": asset,
                        "video_url": result.public_url,
                        "source": "execute_storyboard",
                        "tool_name": result.tool_name,
                    },
                )
                review_event = build_review_event_from_asset(asset)
                if review_event:
                    await send_session_update(user_id, session_id, canvas_id, review_event)
                generated_videos.append(result.public_url)
                await _ensure_continuity_tail_world_asset(
                    clip_index=result.clip_index,
                    shot_index=result.shot_index,
                    source_video_url=result.public_url,
                    source_download_url=result.provider_video_url,
                    world_refs=list(result.world_refs),
                    primary_world_ref=result.primary_world_ref,
                    required=False,
                )

            async def _run_video_clip_with_capture(clip: dict[str, Any]) -> tuple[int, dict[str, Any], Optional[VideoGenerationResult], Optional[Exception]]:
                try:
                    result = await _generate_video_clip(clip)
                    return int(clip["clipIndex"]), clip, result, None
                except Exception as exc:
                    return int(clip["clipIndex"]), clip, None, exc

            def _format_video_failure_message(task_error: Exception | None) -> str:
                if task_error is None:
                    return "unknown video generation failure"
                raw_message = str(task_error or "").strip()
                if raw_message:
                    return raw_message
                repr_message = repr(task_error).strip()
                if repr_message and repr_message != "Exception()":
                    return repr_message
                return f"{task_error.__class__.__name__} raised without message"

            batch_groups: dict[int, list[dict[str, Any]]] = {}
            for clip in ordered_pending_clips:
                clip_index = int(clip["clipIndex"])
                batch_id = ((clip_index - 1) // VIDEO_GENERATION_BATCH_SIZE) + 1
                batch_groups.setdefault(batch_id, []).append(clip)

            async def _record_video_failure(clip_index: int, failure_message: str) -> None:
                video_failures.append(f"clip {clip_index}: {failure_message}")
                await _persist_storyboard_resume_state(
                    status="failed",
                    phase_name="videos",
                    failed_clip_index=int(clip_index),
                    failure_message=failure_message,
                )
                await send_session_update(
                    user_id,
                    session_id,
                    canvas_id,
                    {
                        "type": "error",
                        "error": f"Video clip generation failed at clip {clip_index}; stopping remaining clips: {failure_message}",
                    },
                )

            async def _commit_video_result(result: VideoGenerationResult, clip: dict[str, Any]) -> None:
                await _persist_generated_video_result(result, clip)
                nonlocal completed_count
                completed_count += 1
                await _persist_storyboard_resume_state(status="running", phase_name="videos")
                await _emit_executor_progress(
                    _executor_progress_message(
                        "video_progress",
                        preferred_language,
                        done=completed_count,
                        total=len(ordered_pending_clip_indexes),
                    )
                )

            batch_failed = False
            try:
                for batch_id in sorted(batch_groups.keys()):
                    clip_batch = sorted(batch_groups[batch_id], key=lambda item: int(item["clipIndex"]))
                    if not clip_batch:
                        continue

                    if batch_id == 1:
                        if any(int(clip["clipIndex"]) == 1 for clip in clip_batch):
                            await _maybe_wait_for_video_gate(
                                logical_batch_index=1,
                                total_batches=total_batches,
                                clip_batch=[clip_batch[0]],
                                timeout_seconds=FIRST_VIDEO_GATE_TIMEOUT_SECONDS,
                            )
                        for clip in clip_batch:
                            clip_index, clip_payload, result, task_error = await _run_video_clip_with_capture(clip)
                            if task_error is not None:
                                await _record_video_failure(clip_index, _format_video_failure_message(task_error))
                                batch_failed = True
                                break
                            if result is None:
                                await _record_video_failure(clip_index, "unknown video generation failure")
                                batch_failed = True
                                break
                            await _commit_video_result(result, clip_payload)
                        if batch_failed:
                            break
                        continue

                    if batch_id == 2:
                        await _maybe_wait_for_video_gate(
                            logical_batch_index=batch_id,
                            total_batches=total_batches,
                            clip_batch=clip_batch,
                            timeout_seconds=SECOND_BATCH_GATE_TIMEOUT_SECONDS,
                        )

                    batch_results = await asyncio.gather(*[_run_video_clip_with_capture(clip) for clip in clip_batch])
                    batch_results.sort(key=lambda item: item[0])
                    for clip_index, clip_payload, result, task_error in batch_results:
                        if task_error is not None:
                            await _record_video_failure(clip_index, _format_video_failure_message(task_error))
                            batch_failed = True
                            continue
                        if result is None:
                            await _record_video_failure(clip_index, "unknown video generation failure")
                            batch_failed = True
                            continue
                        await _commit_video_result(result, clip_payload)

                    if batch_failed:
                        break
            except asyncio.CancelledError:
                await _persist_storyboard_resume_state(status="interrupted", phase_name="videos")
                raise

            if video_failures:
                failure_preview = " | ".join(video_failures[:MAX_VIDEO_FAILURES_IN_MESSAGE])
                first_failed_clip_index: Optional[int] = None
                match = re.search(r"clip\s+(\d+)", failure_preview)
                if match:
                    try:
                        first_failed_clip_index = int(match.group(1))
                    except Exception:
                        first_failed_clip_index = None
                await _persist_storyboard_resume_state(
                    status="interrupted",
                    phase_name="videos",
                    failed_clip_index=first_failed_clip_index,
                    failure_message=failure_preview,
                )
                await _emit_executor_progress(
                    f"Video generation paused after a recoverable failure. Send continue to resume from the latest timeline state. {failure_preview}"
                )
                return (
                    "execute_storyboard paused: video_generation_failed; "
                    f"completed_videos={len(generated_videos)}, pending_videos={len(ordered_pending_clip_indexes) - completed_count}, "
                    f"failure={failure_preview}"
                )

    # Keep the tool result compact; per-asset cards are emitted as regular assistant messages.
    await _emit_executor_progress(_executor_progress_message("finalize", preferred_language))
    _persist_storyboard_identity_memory(
        storyboard=storyboard,
        user_id=user_id,
        aspect_ratio=aspect_ratio,
    )
    await _persist_storyboard_resume_state(status="completed", phase_name="finalize")
    await _emit_executor_progress("")
    return (
        f"execute_storyboard completed: keyframes_planned={len(keyframe_plan)}, videos_planned={len(video_plan)}, "
        f"world_assets_available={len(world_video_refs_by_id)}, images_generated={len(generated_images)}, videos_generated={len(generated_videos)}, "
        f"duration={CANONICAL_DURATION_SECONDS}, aspect_ratio={aspect_ratio}, memory_persisted=true"
    )
