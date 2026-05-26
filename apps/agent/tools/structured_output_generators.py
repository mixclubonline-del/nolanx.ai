"""
Structured Output generation tool for LangGraph agents.

Why this exists:
- Some deployments do NOT have a usable direct Google GenAI API key (it can be suspended).
- This tool must follow the project's configured LLM provider (default: OpenRouter in `config.toml`).

Implementation:
- Call OpenRouter via ChatOpenAI-compatible endpoint.
- Force JSON-only output via prompting.
- Parse JSON with a strict extractor + a single repair retry.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
from typing import Optional, Annotated, Dict, Any

import httpx
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig

from services.api_client_service import api_client_service
from services.config_service import config_service
from services.nolanx.bridges import invoke_acp_bridge
from services.runtime_logger import log_runtime_event, log_runtime_warning
from services.websocket_service import send_session_update
from services.nolanx.utils.prompt_engineering import (
    build_numbered_media_lines,
    seedance_prompt_engineering_rules,
)
from utils.http_client import HttpClient
from .timeline_utils import create_script_asset


CANONICAL_VIDEO_DURATION_SECONDS = 15
BRIDGE_VIDEO_DURATION_SECONDS = 5
MAIN_VIDEO_DURATION_SECONDS = 15
BRIDGE_ARCHITECTURE_CYCLE_SECONDS = BRIDGE_VIDEO_DURATION_SECONDS + MAIN_VIDEO_DURATION_SECONDS
MIN_STRUCTURED_OUTPUT_MAX_TOKENS = 16384
DEFAULT_STRUCTURED_OUTPUT_ATTEMPTS = 2
DEFAULT_STRUCTURED_MODEL_RETRIES = 0
DEFAULT_STRUCTURED_HTTP_TIMEOUT_SECONDS = 240
DEFAULT_STRUCTURED_MODEL_TIMEOUT_SECONDS = 180
MAX_MISSING_FIELD_REPAIR_ATTEMPTS = 3
SHOT_DETAIL_BATCH_SIZE = 4
_STRUCTURED_OUTPUT_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
_STORYBOARD_CHECKPOINT_CACHE: dict[tuple[str, str, str], dict[str, Any]] = {}
RETRYABLE_HTTPX_ERRORS = (
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.TimeoutException,
    httpx.ProtocolError,
)


def _nolanx_phase_runtime_config() -> dict[str, Any]:
    cfg = config_service.get_service_config("nolanx") or {}
    return cfg.get("phase_runtimes") or {}


async def _try_delegate_structured_output_to_acp(
    *,
    prompt: str,
    output_schema: Dict[str, Any],
    config: RunnableConfig,
    response_format: Optional[Any],
) -> Optional[str]:
    phase_cfg = (_nolanx_phase_runtime_config().get("script_writer") or {})
    if not phase_cfg.get("enabled"):
        return None

    bridge_name = str(phase_cfg.get("bridge_name") or "").strip()
    operation = str(phase_cfg.get("operation") or "generate_structured_output").strip()
    if not bridge_name:
        return None

    configurable = config.get("configurable", {}) or {}
    result = await invoke_acp_bridge(
        bridge_name=bridge_name,
        operation=operation,
        payload={
            "prompt": prompt,
            "output_schema": output_schema,
            "response_format": response_format,
            "preferred_language": configurable.get("preferred_language"),
            "preferred_language_instruction": configurable.get("preferred_language_instruction"),
            "auto_skills": configurable.get("auto_skills") or [],
            "agent_auto_skills": (configurable.get("agent_auto_skill_map") or {}).get("script_writer") or [],
        },
        session_id=configurable.get("session_id"),
        canvas_id=configurable.get("canvas_id"),
        user_id=configurable.get("user_id"),
    )

    remote = result.get("result") if isinstance(result, dict) else None
    if isinstance(remote, dict):
        if isinstance(remote.get("content"), str) and remote.get("content").strip():
            return remote.get("content").strip()
        structured_output = remote.get("structured_output")
        if isinstance(structured_output, dict) and structured_output:
            fingerprint = cache_latest_structured_output(
                canvas_id=str(configurable.get("canvas_id") or ""),
                session_id=str(configurable.get("session_id") or ""),
                structured_output=structured_output,
            )
            summary = {
                "title": structured_output.get("title"),
                "total_duration_seconds": structured_output.get("total_duration_seconds"),
                "clip_count": len(structured_output.get("shots") or []),
                "fingerprint": fingerprint,
                "delegated": True,
                "bridge": bridge_name,
            }
            return (
                "📊 Structured output generated successfully - Provider: ACP\n\n"
                "**Structured Output Cached:**\n```json\n"
                + json.dumps(summary, indent=2, ensure_ascii=False)
                + "\n```"
            )
    return None


_STRUCTURED_PROGRESS_MESSAGES: dict[str, dict[str, str]] = {
    "generate_storyboard": {
        "en": "Generating detailed storyboard JSON for Script Track...",
        "zh-CN": "正在为脚本轨生成详细分镜 JSON...",
        "ja-JP": "スクリプトトラック用の詳細な絵コンテ JSON を生成しています...",
        "ko-KR": "스크립트 트랙용 상세 스토리보드 JSON을 생성하는 중입니다...",
    },
    "retry_storyboard": {
        "en": "Retrying storyboard JSON generation ({attempt}/{max_attempts})...",
        "zh-CN": "正在重试分镜 JSON 生成（{attempt}/{max_attempts}）...",
        "ja-JP": "絵コンテ JSON の生成を再試行しています（{attempt}/{max_attempts}）...",
        "ko-KR": "스토리보드 JSON 생성을 재시도하는 중입니다 ({attempt}/{max_attempts})...",
    },
    "attempt_failed_retrying": {
        "en": "Storyboard JSON attempt {attempt}/{max_attempts} failed: {error}. Retrying...",
        "zh-CN": "分镜 JSON 第 {attempt}/{max_attempts} 次尝试失败：{error}。正在重试...",
        "ja-JP": "絵コンテ JSON の試行 {attempt}/{max_attempts} が失敗しました: {error}。再試行しています...",
        "ko-KR": "스토리보드 JSON 시도 {attempt}/{max_attempts} 실패: {error}. 재시도 중입니다...",
    },
    "overview": {
        "en": "Designing storyboard overview, screenplay, and world bible...",
        "zh-CN": "正在设计分镜总览、完整剧本与世界观圣经...",
        "ja-JP": "絵コンテ全体設計、脚本、ワールドバイブルを構築しています...",
        "ko-KR": "스토리보드 개요, 각본, 월드 바이블을 설계하는 중입니다...",
    },
    "shot": {
        "en": "Designing shot {index}/{total} ({title})...",
        "zh-CN": "正在设计镜头 {index}/{total}（{title}）...",
        "ja-JP": "ショット {index}/{total}（{title}）を設計しています...",
        "ko-KR": "{index}/{total} 쇼트({title})를 설계하는 중입니다...",
    },
    "resume_shots": {
        "en": "Resuming storyboard queue from shot {index}/{total}; restored {restored} completed shots from checkpoint.",
        "zh-CN": "正在从镜头 {index}/{total} 恢复分镜队列；已从检查点恢复 {restored} 个已完成镜头。",
        "ja-JP": "ショット {index}/{total} から絵コンテキューを再開しています。チェックポイントから {restored} 件の完了ショットを復元しました。",
        "ko-KR": "{index}/{total} 쇼트부터 스토리보드 큐를 재개합니다. 체크포인트에서 완료된 쇼트 {restored}개를 복원했습니다.",
    },
    "batch_done": {
        "en": "Completed shots {start}-{end}; {done}/{total} shots ready. Summary: {summary}",
        "zh-CN": "已完成镜头 {start}-{end}；{done}/{total} 个镜头已就绪。摘要：{summary}",
        "ja-JP": "ショット {start}-{end} が完了しました。{done}/{total} ショット準備完了。要約: {summary}",
        "ko-KR": "쇼트 {start}-{end} 완료. {done}/{total}개 쇼트 준비됨. 요약: {summary}",
    },
    "assemble": {
        "en": "Assembling final storyboard package...",
        "zh-CN": "正在组装最终分镜包...",
        "ja-JP": "最終ストーリーボードパッケージを組み立てています...",
        "ko-KR": "최종 스토리보드 패키지를 조립하는 중입니다...",
    },
    "repair_missing": {
        "en": "Repairing missing structured fields ({attempt}/{max_attempts}): {fields}...",
        "zh-CN": "正在修复缺失的结构化字段（{attempt}/{max_attempts}）：{fields}...",
        "ja-JP": "不足している構造化フィールドを修復しています（{attempt}/{max_attempts}）: {fields}...",
        "ko-KR": "누락된 구조화 필드를 복구하는 중입니다 ({attempt}/{max_attempts}): {fields}...",
    },
    "handoff": {
        "en": "Storyboard JSON generated. Handing back to planner...",
        "zh-CN": "分镜 JSON 已生成，正在交回给规划器...",
        "ja-JP": "ストーリーボード JSON を生成しました。プランナーへ返しています...",
        "ko-KR": "스토리보드 JSON 생성 완료. 플래너로 반환하는 중입니다...",
    },
    "failed": {
        "en": "Structured output generation failed: {error}",
        "zh-CN": "结构化输出生成失败：{error}",
        "ja-JP": "構造化出力の生成に失敗しました: {error}",
        "ko-KR": "구조화 출력 생성에 실패했습니다: {error}",
    },
}


def _normalize_progress_locale(preferred_language: str | None) -> str:
    locale = str(preferred_language or "").strip()
    if locale in _STRUCTURED_PROGRESS_MESSAGES["generate_storyboard"]:
        return locale
    if locale.startswith("zh"):
        return "zh-CN"
    if locale.startswith("ja"):
        return "ja-JP"
    if locale.startswith("ko"):
        return "ko-KR"
    return "en"


def _augment_prompt_with_runtime_media_context(prompt: str, configurable: Dict[str, Any]) -> str:
    uploaded_image_urls = configurable.get("uploaded_image_urls") or []
    uploaded_video_urls = configurable.get("uploaded_video_urls") or []
    uploaded_audio_urls = configurable.get("uploaded_audio_urls") or []
    user_wants_self_insert = bool(configurable.get("user_wants_self_insert"))
    clean_urls = [str(url).strip() for url in uploaded_image_urls if str(url).strip()]
    clean_video_urls = [str(url).strip() for url in uploaded_video_urls if str(url).strip()]
    clean_audio_urls = [str(url).strip() for url in uploaded_audio_urls if str(url).strip()]
    if not clean_urls and not clean_video_urls and not clean_audio_urls:
        return prompt

    media_lines = build_numbered_media_lines(
        image_urls=clean_urls,
        video_urls=clean_video_urls,
        audio_urls=clean_audio_urls,
        user_wants_self_insert=user_wants_self_insert,
    )
    media_lines.insert(1, "The chat input included uploaded media that must remain available to the planner/script pipeline.")
    media_lines.extend(f"- {rule}" for rule in seedance_prompt_engineering_rules()[:4])
    return f"{prompt.strip()}\n\n" + "\n".join(media_lines)


def _structured_progress_message(key: str, preferred_language: str | None, **values: Any) -> str:
    locale = _normalize_progress_locale(preferred_language)
    template = (
        _STRUCTURED_PROGRESS_MESSAGES.get(key, {}).get(locale)
        or _STRUCTURED_PROGRESS_MESSAGES.get(key, {}).get("en")
        or key
    )
    safe_values = {k: str(v) for k, v in values.items()}
    return template.format(**safe_values)


def _storyboard_batch_ranges(total_shots: int) -> list[dict[str, int]]:
    total = max(0, int(total_shots or 0))
    ranges: list[dict[str, int]] = []
    batch_number = 0
    for start in range(1, total + 1, SHOT_DETAIL_BATCH_SIZE):
        batch_number += 1
        end = min(total, start + SHOT_DETAIL_BATCH_SIZE - 1)
        ranges.append(
            {
                "batchNumber": batch_number,
                "startShot": start,
                "endShot": end,
                "size": end - start + 1,
            }
        )
    return ranges


def _storyboard_progress_percent(*, phase: str, total_shots: int, completed_shots: int) -> int:
    total = max(0, int(total_shots or 0))
    done = max(0, min(total, int(completed_shots or 0)))
    if phase == "overview":
        return 5
    if phase == "shot_queue":
        if total <= 0:
            return 10
        return min(90, 10 + int(round((done / total) * 80)))
    if phase == "assemble":
        return 95
    if phase == "completed":
        return 100
    if phase == "failed":
        if total <= 0:
            return 0
        return min(95, 10 + int(round((done / total) * 80)))
    if phase == "retrying":
        if total <= 0:
            return 0
        return min(95, 10 + int(round((done / total) * 80)))
    return 0


def _build_storyboard_workflow_state(
    *,
    request_fingerprint: str,
    phase: str,
    status: str,
    total_shots: int,
    completed_shots: int,
    current_batch: Optional[dict[str, Any]] = None,
    failed_batch: Optional[dict[str, Any]] = None,
    restored_shots: int = 0,
    attempt: Optional[int] = None,
    max_attempts: Optional[int] = None,
    summary: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    total = max(0, int(total_shots or 0))
    done = max(0, min(total, int(completed_shots or 0)))
    batch_ranges = _storyboard_batch_ranges(total)
    queue: list[dict[str, Any]] = []
    current_key = None
    if isinstance(current_batch, dict):
        current_key = (
            int(current_batch.get("startShot") or 0),
            int(current_batch.get("endShot") or 0),
        )
    failed_key = None
    if isinstance(failed_batch, dict):
        failed_key = (
            int(failed_batch.get("startShot") or 0),
            int(failed_batch.get("endShot") or 0),
        )

    for batch in batch_ranges:
        batch_key = (batch["startShot"], batch["endShot"])
        if batch["endShot"] <= done:
            batch_status = "completed"
        elif failed_key == batch_key:
            batch_status = "failed"
        elif current_key == batch_key:
            batch_status = str(current_batch.get("status") or "running")
        else:
            batch_status = "pending"
        queue.append({**batch, "status": batch_status})

    completed_batches = [batch for batch in queue if batch["status"] == "completed"]
    remaining_batches = [batch for batch in queue if batch["status"] not in {"completed"}]
    next_pending = next((batch for batch in queue if batch["status"] == "pending"), None)
    return {
        "kind": "storyboard_generation",
        "requestFingerprint": request_fingerprint,
        "phase": phase,
        "status": status,
        "progressPercent": _storyboard_progress_percent(
            phase=phase,
            total_shots=total,
            completed_shots=done,
        ),
        "totalShots": total,
        "completedShots": done,
        "remainingShots": max(0, total - done),
        "restoredShots": max(0, int(restored_shots or 0)),
        "resumeFromShot": done + 1 if total and done < total else None,
        "currentBatch": current_batch,
        "failedBatch": failed_batch,
        "completedBatches": completed_batches,
        "remainingBatches": remaining_batches,
        "queue": queue,
        "nextPendingBatch": next_pending,
        "attempt": attempt,
        "maxAttempts": max_attempts,
        "summary": str(summary or "").strip() or None,
        "error": str(error or "").strip() or None,
    }


class GenerateStructuredOutputInputSchema(BaseModel):
    prompt: str = Field(description="Content generation prompt")
    output_schema: Dict[str, Any] = Field(description="JSON schema for the structured output")
    # Some model providers (or agent prompts) may pass OpenAI-style objects like {"type":"json_object"}.
    # Accept any shape here and ignore it; we always return JSON text.
    response_format: Optional[Any] = Field(
        default="json",
        description="Optional response_format hint (string or object). Ignored; tool always returns JSON.",
    )
    tool_call_id: Annotated[str, InjectedToolCallId]


def _structured_output_cache_key(*, canvas_id: str, session_id: str) -> tuple[str, str]:
    return (str(canvas_id or "").strip(), str(session_id or "").strip())


def _storyboard_checkpoint_key(*, canvas_id: str, session_id: str, request_fingerprint: str) -> tuple[str, str, str]:
    return (
        str(canvas_id or "").strip(),
        str(session_id or "").strip(),
        str(request_fingerprint or "").strip(),
    )


def cache_latest_structured_output(*, canvas_id: str, session_id: str, structured_output: dict[str, Any]) -> str:
    key = _structured_output_cache_key(canvas_id=canvas_id, session_id=session_id)
    normalized = copy.deepcopy(structured_output)
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    fingerprint = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    _STRUCTURED_OUTPUT_CACHE[key] = {
        "fingerprint": fingerprint,
        "structured_output": normalized,
    }
    return fingerprint


def get_latest_structured_output(*, canvas_id: str, session_id: str) -> Optional[dict[str, Any]]:
    key = _structured_output_cache_key(canvas_id=canvas_id, session_id=session_id)
    cached = _STRUCTURED_OUTPUT_CACHE.get(key)
    if not isinstance(cached, dict):
        return None
    structured_output = cached.get("structured_output")
    if not isinstance(structured_output, dict):
        return None
    return copy.deepcopy(structured_output)


def _storyboard_request_fingerprint(
    *,
    prompt: str,
    output_schema: Dict[str, Any],
    preferred_language: str | None,
) -> str:
    payload = json.dumps(
        {
            "prompt": str(prompt or "").strip(),
            "output_schema": output_schema,
            "preferred_language": str(preferred_language or "").strip(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def get_storyboard_checkpoint(
    *,
    canvas_id: str,
    session_id: str,
    request_fingerprint: str,
) -> Optional[dict[str, Any]]:
    key = _storyboard_checkpoint_key(
        canvas_id=canvas_id,
        session_id=session_id,
        request_fingerprint=request_fingerprint,
    )
    checkpoint = _STORYBOARD_CHECKPOINT_CACHE.get(key)
    if not isinstance(checkpoint, dict):
        return None
    return copy.deepcopy(checkpoint)


def cache_storyboard_checkpoint(
    *,
    canvas_id: str,
    session_id: str,
    request_fingerprint: str,
    checkpoint: dict[str, Any],
) -> None:
    key = _storyboard_checkpoint_key(
        canvas_id=canvas_id,
        session_id=session_id,
        request_fingerprint=request_fingerprint,
    )
    _STORYBOARD_CHECKPOINT_CACHE[key] = copy.deepcopy(checkpoint)


def clear_storyboard_checkpoint(
    *,
    canvas_id: str,
    session_id: str,
    request_fingerprint: str,
) -> None:
    key = _storyboard_checkpoint_key(
        canvas_id=canvas_id,
        session_id=session_id,
        request_fingerprint=request_fingerprint,
    )
    _STORYBOARD_CHECKPOINT_CACHE.pop(key, None)


def _is_storyboard_schema(output_schema: Dict[str, Any]) -> bool:
    if not isinstance(output_schema, dict):
        return False
    props = output_schema.get("properties") or {}
    if not isinstance(props, dict):
        return False
    return all(key in props for key in ("title", "premise", "shots", "script_segments", "bible", "screenplay"))


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _schema_expects_object(schema: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        return "object" in schema_type
    return schema_type == "object" or isinstance(schema.get("required"), list)


def _storyboard_overview_schema(output_schema: Dict[str, Any]) -> Dict[str, Any]:
    props = copy.deepcopy(_as_dict(_as_dict(output_schema).get("properties")))
    overview_props = {
        key: props[key]
        for key in (
            "title",
            "premise",
            "style",
            "aspect_ratio",
            "total_duration_seconds",
            "story_metrics",
            "screenplay",
            "visual_bible",
            "bible",
            "audio",
            "safety",
        )
        if key in props
    }
    overview_props["shot_blueprints"] = {
        "type": "array",
        "items": {
            "type": "object",
            "required": [
                "index",
                "start_sec",
                "end_sec",
                "duration_seconds",
                "title",
                "goal",
                "scene_tag",
            ],
            "properties": {
                "index": {"type": "number"},
                "start_sec": {"type": "number"},
                "end_sec": {"type": "number"},
                "duration_seconds": {"type": "number"},
                "title": {"type": "string"},
                "goal": {"type": "string"},
                "scene_tag": {"type": "string"},
                "continuity_note": {"type": "string"},
                "must_include": {"type": "array", "items": {"type": "string"}},
                "characters": {"type": "array", "items": {"type": "string"}},
                "locations": {"type": "array", "items": {"type": "string"}},
                "props": {"type": "array", "items": {"type": "string"}},
                "dialogue_intent": {"type": "string"},
                "visual_focus": {"type": "string"},
            },
        },
    }
    return {
        "type": "object",
        "required": [
            "title",
            "premise",
            "style",
            "aspect_ratio",
            "total_duration_seconds",
            "story_metrics",
            "screenplay",
            "visual_bible",
            "bible",
            "audio",
            "safety",
            "shot_blueprints",
        ],
        "properties": overview_props,
    }


def _storyboard_shot_chunk_schema(output_schema: Dict[str, Any]) -> Dict[str, Any]:
    props = _as_dict(_as_dict(output_schema).get("properties"))
    shot_schema = copy.deepcopy(_as_dict(props.get("shots")).get("items") or {"type": "object"})
    segment_schema = copy.deepcopy(_as_dict(props.get("script_segments")).get("items") or {"type": "object"})
    return {
        "type": "object",
        "required": ["shot", "script_segment", "brief_summary"],
        "properties": {
            "shot": shot_schema,
            "script_segment": segment_schema,
            "brief_summary": {"type": "string"},
        },
    }


def _storyboard_shot_batch_schema(output_schema: Dict[str, Any], batch_size: int) -> Dict[str, Any]:
    single_item_schema = _storyboard_shot_chunk_schema(output_schema)
    return {
        "type": "object",
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "minItems": batch_size,
                "maxItems": batch_size,
                "items": single_item_schema,
            },
        },
    }


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _normalize_storyboard_blueprints(overview: Dict[str, Any]) -> list[dict[str, Any]]:
    overview = _as_dict(overview)
    story_metrics = _as_dict(overview.get("story_metrics"))
    total_duration = _safe_int(overview.get("total_duration_seconds"), 0)
    clip_count = _safe_int(story_metrics.get("clip_count"), 0)
    blueprints = _as_list(overview.get("shot_blueprints"))

    if clip_count <= 0:
        clip_count = len(blueprints) if blueprints else max(
            1,
            (total_duration + BRIDGE_ARCHITECTURE_CYCLE_SECONDS - 1) // BRIDGE_ARCHITECTURE_CYCLE_SECONDS * 2,
        )
    if clip_count <= 0:
        clip_count = 1

    normalized: list[dict[str, Any]] = []
    cursor_sec = 0
    for idx in range(clip_count):
        raw = blueprints[idx] if idx < len(blueprints) and isinstance(blueprints[idx], dict) else {}
        raw_role = str(raw.get("clip_role") or raw.get("role") or raw.get("shot_role") or "").strip().lower()
        is_anchor = (
            raw_role in {"bridge", "bridge_5s", "transition", "transition_5s", "anchor", "anchor_5s", "key_anchor_5s"}
            or (not raw_role and idx % 2 == 0)
        )
        clip_role = "anchor_5s" if is_anchor else "story_15s"
        default_duration = BRIDGE_VIDEO_DURATION_SECONDS if is_anchor else MAIN_VIDEO_DURATION_SECONDS
        start_sec = _safe_int(raw.get("start_sec"), cursor_sec)
        duration_seconds = _safe_int(raw.get("duration_seconds"), default_duration)
        if clip_role == "anchor_5s":
            duration_seconds = BRIDGE_VIDEO_DURATION_SECONDS
        elif duration_seconds <= 0:
            duration_seconds = MAIN_VIDEO_DURATION_SECONDS
        end_sec = _safe_int(raw.get("end_sec"), start_sec + duration_seconds)
        if end_sec <= start_sec:
            end_sec = start_sec + duration_seconds
        cursor_sec = end_sec
        normalized.append({
            "index": idx + 1,
            "start_sec": start_sec,
            "end_sec": end_sec,
            "duration_seconds": duration_seconds,
            "clip_role": clip_role,
            "anchor_group_index": idx // 2 + 1 if clip_role == "anchor_5s" else None,
            "anchor_pair": {
                "previous_anchor_index": idx if clip_role == "story_15s" else None,
                "next_anchor_index": idx + 2 if clip_role == "story_15s" else None,
            },
            "title": str(raw.get("title") or f"Shot {idx + 1}").strip(),
            "goal": str(raw.get("goal") or "").strip(),
            "scene_tag": str(raw.get("scene_tag") or "").strip(),
            "continuity_note": str(raw.get("continuity_note") or "").strip(),
            "must_include": raw.get("must_include") if isinstance(raw.get("must_include"), list) else [],
            "characters": raw.get("characters") if isinstance(raw.get("characters"), list) else [],
            "locations": raw.get("locations") if isinstance(raw.get("locations"), list) else [],
            "props": raw.get("props") if isinstance(raw.get("props"), list) else [],
            "dialogue_intent": str(raw.get("dialogue_intent") or "").strip(),
            "visual_focus": str(raw.get("visual_focus") or "").strip(),
        })
    return normalized


def _normalize_storyboard_chunk(
    *,
    chunk: Dict[str, Any],
    blueprint: Dict[str, Any],
) -> Dict[str, Any]:
    shot = chunk.get("shot") if isinstance(chunk.get("shot"), dict) else {}
    segment = chunk.get("script_segment") if isinstance(chunk.get("script_segment"), dict) else {}

    shot_index = _safe_int(shot.get("index"), _safe_int(blueprint.get("index"), 1))
    start_sec = _safe_int(shot.get("start_sec"), _safe_int(blueprint.get("start_sec"), 0))
    end_sec = _safe_int(shot.get("end_sec"), _safe_int(blueprint.get("end_sec"), start_sec + CANONICAL_VIDEO_DURATION_SECONDS))
    duration_seconds = _safe_int(shot.get("duration_seconds"), _safe_int(blueprint.get("duration_seconds"), CANONICAL_VIDEO_DURATION_SECONDS))
    if duration_seconds <= 0:
        duration_seconds = max(CANONICAL_VIDEO_DURATION_SECONDS, end_sec - start_sec)
    clip_role = str(shot.get("clip_role") or blueprint.get("clip_role") or "").strip() or (
        "anchor_5s" if duration_seconds <= BRIDGE_VIDEO_DURATION_SECONDS else "story_15s"
    )
    if clip_role == "anchor_5s":
        duration_seconds = BRIDGE_VIDEO_DURATION_SECONDS
        end_sec = start_sec + duration_seconds
    elif duration_seconds <= BRIDGE_VIDEO_DURATION_SECONDS:
        duration_seconds = MAIN_VIDEO_DURATION_SECONDS
        end_sec = start_sec + duration_seconds
    binding_lock = str(shot.get("binding_lock") or f"SHOT_{shot_index:03d}_LOCK").strip()

    world_refs = shot.get("world_refs") if isinstance(shot.get("world_refs"), list) else []
    if not world_refs:
        inferred_refs: list[str] = []
        for key in ("characters", "locations", "props"):
            entries = shot.get(key) if isinstance(shot.get(key), list) else []
            for entry in entries:
                if isinstance(entry, dict):
                    code = str(entry.get("code") or "").strip()
                    if code and code not in inferred_refs:
                        inferred_refs.append(code)
        world_refs = inferred_refs

    continuity_note = str(
        shot.get("continuity_note")
        or segment.get("continuity_note")
        or blueprint.get("continuity_note")
        or ""
    ).strip()

    subshots = shot.get("subshots") if isinstance(shot.get("subshots"), list) else []
    provided_subshots = [sub for sub in subshots if isinstance(sub, dict)]
    target_subshot_count = len(provided_subshots) if provided_subshots else (2 if clip_role == "anchor_5s" else 6)
    target_subshot_count = max(1, min(duration_seconds, target_subshot_count))
    default_cameras = [
        "continuation pickup framing",
        "medium action follow",
        "close reaction",
        "insert detail",
        "over-shoulder counter",
        "tight emotional push-in",
        "motion-follow transition",
        "handoff bridge framing",
    ]
    normalized_subshots: list[Dict[str, Any]] = []
    boundaries = [
        round((duration_seconds * idx) / target_subshot_count, 2)
        for idx in range(target_subshot_count + 1)
    ]

    for idx in range(target_subshot_count):
        raw_subshot = provided_subshots[idx] if idx < len(provided_subshots) else {}
        beat_description = str(raw_subshot.get("beat_description") or "").strip()
        if not beat_description:
            if idx == 0 and continuity_note:
                beat_description = f"{continuity_note}; begin on carried-over continuity rather than replaying the previous clip."
            elif idx == target_subshot_count - 1:
                beat_description = str(shot.get("character_action") or shot.get("shot_description") or blueprint.get("goal") or "").strip()
                if beat_description:
                    beat_description = f"{beat_description}; resolve this clip's turn and land on a transition-ready ending beat for the next clip without duplicating the next opening."
            else:
                beat_description = str(shot.get("character_action") or shot.get("shot_description") or blueprint.get("goal") or blueprint.get("visual_focus") or "").strip()

        camera_index = round((len(default_cameras) - 1) * idx / max(1, target_subshot_count - 1))
        start_offset = boundaries[idx]
        end_offset = boundaries[idx + 1]
        normalized_subshots.append(
            {
                "label": str(raw_subshot.get("label") or f"Beat {idx + 1}").strip(),
                "start_offset_sec": start_offset,
                "end_offset_sec": end_offset,
                "beat_description": beat_description,
                "camera": str(raw_subshot.get("camera") or default_cameras[camera_index]).strip(),
                "action": str(raw_subshot.get("action") or shot.get("character_action") or "").strip(),
                "emotion": str(raw_subshot.get("emotion") or shot.get("emotion") or "").strip(),
                "audio": str(raw_subshot.get("audio") or shot.get("sound_effects") or segment.get("sound_effects") or "").strip(),
                "focus_world_refs": raw_subshot.get("focus_world_refs") if isinstance(raw_subshot.get("focus_world_refs"), list) else shot.get("world_refs") or [],
                "dialogue": str(raw_subshot.get("dialogue") or "").strip(),
                "voice_ref": str(raw_subshot.get("voice_ref") or "").strip(),
                "voice_direction": str(raw_subshot.get("voice_direction") or shot.get("voice_direction") or "").strip(),
            }
        )

    shot["index"] = shot_index
    shot["start_sec"] = start_sec
    shot["end_sec"] = end_sec
    shot["duration_seconds"] = duration_seconds
    shot["clip_role"] = clip_role
    shot["anchor_group_index"] = blueprint.get("anchor_group_index") or shot.get("anchor_group_index")
    shot["anchor_pair"] = shot.get("anchor_pair") if isinstance(shot.get("anchor_pair"), dict) else blueprint.get("anchor_pair")
    shot["binding_lock"] = binding_lock
    shot["continuity_note"] = continuity_note
    shot["world_refs"] = [str(ref).strip() for ref in world_refs if str(ref).strip()]
    shot["subshots"] = normalized_subshots
    if shot["world_refs"] and not str(shot.get("video_primary_world_ref") or "").strip():
        shot["video_primary_world_ref"] = shot["world_refs"][0]

    segment["shot_index"] = _safe_int(segment.get("shot_index"), shot_index)
    segment["start_sec"] = _safe_int(segment.get("start_sec"), start_sec)
    segment["end_sec"] = _safe_int(segment.get("end_sec"), end_sec)
    segment["duration_seconds"] = _safe_int(segment.get("duration_seconds"), duration_seconds)
    segment["clip_role"] = str(segment.get("clip_role") or shot.get("clip_role") or "").strip()
    segment["anchor_pair"] = segment.get("anchor_pair") if isinstance(segment.get("anchor_pair"), dict) else shot.get("anchor_pair")
    segment["binding_lock"] = str(segment.get("binding_lock") or binding_lock).strip()
    segment["continuity_note"] = continuity_note
    segment_world_refs = segment.get("world_refs") if isinstance(segment.get("world_refs"), list) else []
    if not segment_world_refs:
        segment_world_refs = shot["world_refs"]
    segment["world_refs"] = [str(ref).strip() for ref in segment_world_refs if str(ref).strip()]
    segment["subshot_summary"] = " ; ".join(
        str(subshot.get("beat_description") or "").strip()
        for subshot in normalized_subshots
        if isinstance(subshot, dict) and str(subshot.get("beat_description") or "").strip()
    )

    return {
        "shot": shot,
        "script_segment": segment,
        "brief_summary": str(chunk.get("brief_summary") or "").strip(),
    }


def _normalize_storyboard_batch_chunk(
    *,
    chunk: Dict[str, Any],
    blueprints: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    raw_items = chunk.get("items") if isinstance(chunk.get("items"), list) else []
    if len(raw_items) != len(blueprints):
        raise ValueError(
            f"Storyboard shot batch returned {len(raw_items)} items, expected {len(blueprints)}"
        )

    normalized_items: list[Dict[str, Any]] = []
    for raw_item, blueprint in zip(raw_items, blueprints):
        item = raw_item if isinstance(raw_item, dict) else {}
        normalized_items.append(_normalize_storyboard_chunk(chunk=item, blueprint=blueprint))
    return normalized_items


def _script_draft_asset_id(*, session_id: str, shot_index: int) -> str:
    safe_session = re.sub(r"[^a-zA-Z0-9]+", "", str(session_id or ""))[:12] or "session"
    return f"script-draft-{safe_session}-{int(shot_index):03d}"


def _script_draft_text(*, shot: Dict[str, Any], segment: Dict[str, Any]) -> str:
    primary_text = str(
        segment.get("text")
        or shot.get("shot_description")
        or shot.get("storyboard_prompt")
        or shot.get("keyframe_notes")
        or ""
    ).strip()
    if not primary_text:
        primary_text = str(shot.get("title") or "").strip()

    dialogue = str(shot.get("dialogue") or segment.get("dialogue") or "").strip()
    continuity_note = str(shot.get("continuity_note") or segment.get("continuity_note") or "").strip()
    subshots = shot.get("subshots") if isinstance(shot.get("subshots"), list) else []
    subshot_summary = " | ".join(
        str(subshot.get("beat_description") or "").strip()
        for subshot in subshots
        if isinstance(subshot, dict) and str(subshot.get("beat_description") or "").strip()
    )

    continuity_line = f"Continuity: {continuity_note}" if continuity_note else ""
    parts = [part for part in (primary_text, continuity_line, dialogue, subshot_summary) if part]
    return "\n\n".join(parts).strip()


async def _upsert_script_draft_asset(
    *,
    canvas_id: str,
    session_id: str,
    user_id: str | None,
    normalized_chunk: Dict[str, Any],
    request_fingerprint: str,
    total_shots: int,
) -> None:
    shot = normalized_chunk.get("shot") if isinstance(normalized_chunk.get("shot"), dict) else {}
    segment = normalized_chunk.get("script_segment") if isinstance(normalized_chunk.get("script_segment"), dict) else {}
    shot_index = _safe_int(shot.get("index"), _safe_int(segment.get("shot_index"), 0))
    if shot_index <= 0:
        return

    asset_id = _script_draft_asset_id(session_id=session_id, shot_index=shot_index)
    start_sec = float(_safe_int(shot.get("start_sec"), _safe_int(segment.get("start_sec"), 0)))
    duration_seconds = float(_safe_int(shot.get("duration_seconds"), CANONICAL_VIDEO_DURATION_SECONDS))
    title = str(segment.get("title") or shot.get("title") or f"Shot {shot_index}").strip()
    world_refs = segment.get("world_refs") if isinstance(segment.get("world_refs"), list) else shot.get("world_refs") or []
    voice_refs = segment.get("voice_refs") if isinstance(segment.get("voice_refs"), list) else []
    asset = create_script_asset(
        asset_id=asset_id,
        title=title,
        text=_script_draft_text(shot=shot, segment=segment),
        duration=duration_seconds,
        start_time=start_sec,
        metadata={
            "kind": "script_segment_draft",
            "draft": True,
            "source": "generate_structured_output",
            "sessionId": session_id,
            "requestFingerprint": request_fingerprint,
            "totalShots": total_shots,
            "shotIndex": shot_index,
            "briefSummary": normalized_chunk.get("brief_summary"),
            "checkpointChunk": normalized_chunk,
            "bindingLock": shot.get("binding_lock") or segment.get("binding_lock"),
            "continuityNote": shot.get("continuity_note") or segment.get("continuity_note"),
            "worldRefs": [str(ref).strip() for ref in world_refs if str(ref).strip()],
            "voiceRefs": [str(ref).strip() for ref in voice_refs if str(ref).strip()],
            "voiceDirection": shot.get("voice_direction"),
            "dialogue": shot.get("dialogue") or segment.get("dialogue"),
            "aestheticNotes": shot.get("aesthetic_notes") or segment.get("aesthetic_notes"),
            "compositionNotes": shot.get("composition_notes"),
            "cameraLanguage": shot.get("camera_language"),
            "paletteNotes": shot.get("palette_notes"),
            "lightingMood": shot.get("lighting_mood"),
            "soundEffects": shot.get("sound_effects") or segment.get("sound_effects"),
            "shotDescription": shot.get("shot_description"),
            "videoPrimaryWorldRef": shot.get("video_primary_world_ref"),
            "characters": shot.get("characters") or [],
            "locations": shot.get("locations") or [],
            "props": shot.get("props") or [],
            "dialogueLines": shot.get("dialogue_lines") or [],
            "subshots": shot.get("subshots") or [],
        },
    )

    added = await api_client_service.add_timeline_asset(
        canvas_id=canvas_id,
        asset_type="script",
        asset_data=asset,
        user_id=user_id,
    )
    if not added:
        log_runtime_warning(
            "structured_output.script_draft.upsert_failed",
            canvas_id=canvas_id,
            session_id=session_id,
            shot_index=shot_index,
            asset_id=asset_id,
        )
        return

    if user_id:
        await send_session_update(
            user_id,
            session_id,
            canvas_id,
            {
                "type": "script_generated",
                "source": "generate_structured_output",
                "draft": True,
                "shotIndex": shot_index,
                "asset": asset,
            },
        )


def _checkpoint_recent_summary(recent_summaries: list[str]) -> str:
    clean = [str(item).strip() for item in recent_summaries if str(item).strip()]
    if not clean:
        return "continuity locked"
    return _truncate_text(" | ".join(clean[-2:]), 160)


def _normalize_restored_storyboard_chunks(
    chunks: list[dict[str, Any]],
    *,
    total_shots: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    by_index: dict[int, dict[str, Any]] = {}
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        shot = chunk.get("shot") if isinstance(chunk.get("shot"), dict) else {}
        raw_index = shot.get("index")
        if not isinstance(raw_index, (int, float)):
            continue
        by_index[int(raw_index)] = copy.deepcopy(chunk)

    normalized: list[dict[str, Any]] = []
    summaries: list[str] = []
    for shot_index in range(1, max(0, total_shots) + 1):
        chunk = by_index.get(shot_index)
        if not isinstance(chunk, dict):
            break
        normalized.append(chunk)
        summary = str(chunk.get("brief_summary") or "").strip()
        if summary:
            summaries.append(summary)
    return normalized, summaries


async def _load_storyboard_checkpoint_from_timeline(
    *,
    canvas_id: str,
    session_id: str,
    user_id: str | None,
    request_fingerprint: str,
    total_shots: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    canvas = await api_client_service.get_canvas_data(canvas_id, user_id=user_id)
    canvas_data = canvas.get("data", {}) if isinstance(canvas, dict) else {}
    timeline = canvas_data.get("timeline") if isinstance(canvas_data, dict) else {}
    tracks = timeline.get("tracks") if isinstance(timeline, dict) else []
    if not isinstance(tracks, list):
        return [], []

    script_track = next(
        (track for track in tracks if isinstance(track, dict) and track.get("id") == "script-track"),
        None,
    )
    assets = script_track.get("assets") if isinstance(script_track, dict) else []
    if not isinstance(assets, list):
        return [], []

    restored_chunks: list[dict[str, Any]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
        if metadata.get("kind") != "script_segment_draft":
            continue
        if metadata.get("source") != "generate_structured_output":
            continue
        if str(metadata.get("sessionId") or "").strip() != str(session_id or "").strip():
            continue
        if str(metadata.get("requestFingerprint") or "").strip() != str(request_fingerprint or "").strip():
            continue
        checkpoint_chunk = metadata.get("checkpointChunk")
        if isinstance(checkpoint_chunk, dict):
            restored_chunks.append(copy.deepcopy(checkpoint_chunk))

    return _normalize_restored_storyboard_chunks(restored_chunks, total_shots=total_shots)


def _truncate_text(value: Any, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}... [truncated {len(text) - max_chars} chars]"


def _compact_storyboard_overview_for_shot_prompt(
    overview: Dict[str, Any],
    *,
    screenplay_text_limit: int = 1600,
) -> Dict[str, Any]:
    overview = _as_dict(overview)
    compact: Dict[str, Any] = {
        "title": overview.get("title"),
        "premise": overview.get("premise"),
        "style": overview.get("style"),
        "aspect_ratio": overview.get("aspect_ratio"),
        "total_duration_seconds": overview.get("total_duration_seconds"),
        "story_metrics": copy.deepcopy(_as_dict(overview.get("story_metrics"))),
        "visual_bible": copy.deepcopy(_as_dict(overview.get("visual_bible") or overview.get("visualBible"))),
        "audio": copy.deepcopy(_as_dict(overview.get("audio"))),
        "safety": copy.deepcopy(_as_dict(overview.get("safety"))),
    }

    screenplay = overview.get("screenplay") if isinstance(overview.get("screenplay"), dict) else {}
    compact["screenplay"] = {
        "language": screenplay.get("language"),
        "summary": screenplay.get("summary"),
        "text_excerpt": _truncate_text(screenplay.get("text"), screenplay_text_limit),
    }

    bible_elements = _as_list(_as_dict(overview.get("bible")).get("elements"))
    compact["bible"] = {
        "elements": [
            {
                "id": element.get("id"),
                "kind": element.get("kind"),
                "name": element.get("name"),
                "importance": element.get("importance"),
                "description": element.get("description"),
                "linked_shot_indexes": element.get("linked_shot_indexes"),
                "visual_invariants": element.get("visual_invariants"),
                "tags": element.get("tags"),
            }
            for element in bible_elements
            if isinstance(element, dict)
        ]
    }

    return compact


async def _generate_storyboard_iteratively(
    *,
    prompt: str,
    output_schema: Dict[str, Any],
    canvas_id: str,
    session_id: str,
    user_id: str | None,
    preferred_language: str,
    preferred_language_instruction: str,
    max_tokens: int,
    model_retries: int,
    transport_retries: int,
    http_timeout_seconds: int,
    model_timeout_seconds: int,
    progress_callback,
    workflow_state_callback=None,
    attempt: int = 1,
    max_attempts: int = 1,
) -> Dict[str, Any]:
    request_fingerprint = _storyboard_request_fingerprint(
        prompt=prompt,
        output_schema=output_schema,
        preferred_language=preferred_language,
    )
    checkpoint = get_storyboard_checkpoint(
        canvas_id=canvas_id,
        session_id=session_id,
        request_fingerprint=request_fingerprint,
    ) or {}

    overview = checkpoint.get("overview") if isinstance(checkpoint.get("overview"), dict) else None
    blueprints = checkpoint.get("blueprints") if isinstance(checkpoint.get("blueprints"), list) else None

    if not overview or not blueprints:
        if workflow_state_callback:
            await workflow_state_callback(
                _build_storyboard_workflow_state(
                    request_fingerprint=request_fingerprint,
                    phase="overview",
                    status="running",
                    total_shots=0,
                    completed_shots=0,
                    attempt=attempt,
                    max_attempts=max_attempts,
                )
            )
        overview_schema = _storyboard_overview_schema(output_schema)
        await progress_callback(_structured_progress_message("overview", preferred_language))
        overview_prompt = (
            "Create the master storyboard design package for the request below.\n"
            "This is step 1 of a multi-step storyboard workflow.\n"
            "Do NOT write full detailed shots yet.\n"
            "Instead, produce:\n"
            "- title / premise / style / aspect ratio / total duration\n"
            "- story_metrics with alternating 5-second anchor shots and 15-second story shots\n"
            "- screenplay and summary in the user's language\n"
            "- bible.elements with stable world ids\n"
            "- audio / safety\n"
            "- shot_blueprints: lightweight plan rows in this repeating architecture: 5s anchor, 15s story, 5s anchor, 15s story...\n"
            "Requirements:\n"
            "- Infer one global format intent for the package: overseas short drama / domestic short drama / cinematic film / advertisement / general video\n"
            "- Choose one top-level aspect_ratio for the whole package:\n"
            "  * 9:16 for phone-first short drama / vertical episodic storytelling\n"
            "  * 2.39:1 for cinematic film language / premium movie-like presentation\n"
            "  * 16:9 for standard horizontal ads and general video\n"
            "- Keep that aspect_ratio consistent across the whole package\n"
            "- The opening should enter quickly into scene, character, and event rather than spending too long on background exposition\n"
            "- Use scene action, staging, and concise dialogue to reveal deeper background instead of front-loading lore\n"
            "- `audio` is integrated video-audio direction for the package, not a mandatory separate audio pipeline\n"
            "- Absorb any specialized user overlays such as overseas short drama adaptation, domestic short drama adaptation, character-sheet / three-view modeling, and pure no-human scene extraction\n"
            "- Treat character-sheet / three-view requirements as world-reference asset rules, not as the visual layout of normal story shots\n"
            "- shot_blueprints length MUST equal story_metrics.clip_count\n"
            "- `clip_role` must be `anchor_5s` for the 5-second shots and `story_15s` for the 15-second shots\n"
            "- 5-second `anchor_5s` shots are NOT filler: each one must be a carefully designed dramatic anchor that can be a key reaction, reveal, montage image, symbolic cutaway, power-shift beat, cliffhanger, or transition hook\n"
            "- 15-second `story_15s` shots must be designed to connect from the previous 5-second anchor ending and land cleanly into the next 5-second anchor opening\n"
            "- Use montage language aggressively where useful: elliptical cuts, symbolic inserts, sensory flashes, sound bridges, match cuts, and compressed action\n"
            "- Every shot_blueprint must include a concrete `continuity_note` describing how that clip enters from the previous clip and/or hands off to the next clip\n"
            "- Design clip-to-clip flow so consecutive 15-second clips feel editorially connected rather than abrupt\n"
            "- Each shot_blueprint should implicitly define an editorial bridge strategy such as match-on-action, eyeline carry, sound bridge, prop continuation, movement direction, or reaction hold\n"
            "- Avoid duplicate boundary beats where Shot N ends on the exact same action or line that Shot N+1 opens with\n"
            "- Use stable world ids such as CHR1 / LOC1 / PROP1 / STYLE1\n"
            "- Keep user-facing fields in the user's language\n"
            "- Fields ending in `_en` must be English\n\n"
            f"USER REQUEST:\n{prompt.strip()}"
        ).strip()
        overview_result = await _generate_structured_with_openrouter(
            prompt=overview_prompt,
            output_schema=overview_schema,
            preferred_language=preferred_language,
            preferred_language_instruction=preferred_language_instruction,
            max_tokens=max_tokens,
            model_retries=model_retries,
            transport_retries=transport_retries,
            http_timeout_seconds=http_timeout_seconds,
            model_timeout_seconds=model_timeout_seconds,
        )
        overview = overview_result.get("structured_output")
        if not isinstance(overview, dict):
            raise ValueError("Storyboard overview generation did not return an object")
        blueprints = _normalize_storyboard_blueprints(overview)
        if not blueprints:
            raise ValueError("Storyboard overview did not produce shot blueprints")
        checkpoint = {
            "overview": copy.deepcopy(overview),
            "blueprints": copy.deepcopy(blueprints),
            "shot_results": [],
            "recent_summaries": [],
        }
        cache_storyboard_checkpoint(
            canvas_id=canvas_id,
            session_id=session_id,
            request_fingerprint=request_fingerprint,
            checkpoint=checkpoint,
        )

    compact_overview = _compact_storyboard_overview_for_shot_prompt(overview)
    total_shots = len(blueprints)
    shot_results, recent_summaries = _normalize_restored_storyboard_chunks(
        checkpoint.get("shot_results") if isinstance(checkpoint.get("shot_results"), list) else [],
        total_shots=total_shots,
    )
    if not shot_results:
        restored_chunks, restored_summaries = await _load_storyboard_checkpoint_from_timeline(
            canvas_id=canvas_id,
            session_id=session_id,
            user_id=user_id,
            request_fingerprint=request_fingerprint,
            total_shots=total_shots,
        )
        if restored_chunks:
            shot_results = restored_chunks
            recent_summaries = restored_summaries
            checkpoint["shot_results"] = copy.deepcopy(shot_results)
            checkpoint["recent_summaries"] = list(recent_summaries)
            cache_storyboard_checkpoint(
                canvas_id=canvas_id,
                session_id=session_id,
                request_fingerprint=request_fingerprint,
                checkpoint=checkpoint,
            )

    if workflow_state_callback:
        await workflow_state_callback(
            _build_storyboard_workflow_state(
                request_fingerprint=request_fingerprint,
                phase="shot_queue",
                status="running",
                total_shots=total_shots,
                completed_shots=len(shot_results),
                restored_shots=len(shot_results),
                current_batch=(
                    None if len(shot_results) >= total_shots else {
                        "startShot": len(shot_results) + 1,
                        "endShot": min(total_shots, len(shot_results) + SHOT_DETAIL_BATCH_SIZE),
                        "status": "running",
                    }
                ),
                attempt=attempt,
                max_attempts=max_attempts,
            )
        )

    if shot_results and len(shot_results) < total_shots:
        await progress_callback(
            _structured_progress_message(
                "resume_shots",
                preferred_language,
                index=len(shot_results) + 1,
                total=total_shots,
                restored=len(shot_results),
            )
        )

    for batch_start in range(len(shot_results), total_shots, SHOT_DETAIL_BATCH_SIZE):
        batch_blueprints = blueprints[batch_start: batch_start + SHOT_DETAIL_BATCH_SIZE]
        batch_end = batch_start + len(batch_blueprints)
        current_batch = {
            "startShot": batch_start + 1,
            "endShot": batch_end,
            "status": "running",
        }
        if workflow_state_callback:
            await workflow_state_callback(
                _build_storyboard_workflow_state(
                    request_fingerprint=request_fingerprint,
                    phase="shot_queue",
                    status="running",
                    total_shots=total_shots,
                    completed_shots=len(shot_results),
                    restored_shots=len(shot_results),
                    current_batch=current_batch,
                    attempt=attempt,
                    max_attempts=max_attempts,
                )
            )
        await progress_callback(
            _structured_progress_message(
                "shot",
                preferred_language,
                index=batch_start + 1,
                total=total_shots,
                title=f"Shots {batch_start + 1}-{batch_end}",
            )
        )
        continuity_context = "\n".join(f"- {item}" for item in recent_summaries[-3:] if item)
        prev_blueprint = blueprints[batch_start - 1] if batch_start > 0 else None
        next_blueprint = blueprints[batch_end] if batch_end < total_shots else None
        batch_schema = _storyboard_shot_batch_schema(output_schema, len(batch_blueprints))
        shot_prompt = (
            f"Create EXACTLY {len(batch_blueprints)} detailed storyboard shots and their matching script segments in one batch.\n"
            "This is part of a larger storyboard package.\n"
            "Return one JSON object with `items`, in the same order as the provided blueprints.\n"
            "Each `items[]` entry must contain exactly one `shot`, one `script_segment`, and one short `brief_summary`.\n"
            "Rules:\n"
            "- The number of returned `items` MUST equal the number of provided blueprints\n"
            "- `items[i].shot.index`, `start_sec`, `end_sec`, `duration_seconds`, and `clip_role` must match blueprint i\n"
            "- If `clip_role` is `anchor_5s`, write it as a polished 5-second key anchor, not filler: it may carry a reveal, reaction, object clue, montage flash, visual metaphor, hard transition, or cliffhanger\n"
            "- If `clip_role` is `story_15s`, write it as the full dramatic movement between the previous anchor and next anchor, with a clear beginning/middle/end and montage compression where useful\n"
            "- `items[i].script_segment` must be 1:1 aligned with `items[i].shot`\n"
            "- Keep continuity coherent across all shots inside this batch, and also respect the provided previous/next batch context\n"
            "- Write the shot as if you are filling a professional storyboard spreadsheet row, not writing a loose paragraph\n"
            "- `shot_description` should function like the final editable 画面描述 column\n"
            "- `characters[].description` should be concrete visual continuity descriptions, useful for casting / costume / look consistency\n"
            "- Write the internal beat design as finely as needed for that shot's actual duration and role\n"
            "- For `anchor_5s`, `subshots` should usually contain 1-3 precise beats with strong visual intent; for `story_15s`, `subshots` should normally contain 4-8 entries depending on dialogue density, action density, emotional rhythm, and whether the moment benefits from a longer take\n"
            "- Each `subshot` must have a distinct beat_description plus concrete camera/action/emotion/audio detail\n"
            "- Make the shot feel visually rich and realistic through internal camera language, not a single flat description\n"
            "- Keep the shot focused on one continuous dramatic objective, while still using multiple camera angles / viewpoints when the duration supports it\n"
            "- Use multi-angle or multi-viewpoint cinematic beats when appropriate: wide, medium, close-up, detail insert, over-shoulder, reaction, motion-follow, environment/crowd beat\n"
            "- Keep the multi-camera coverage motivated, but let all coverage serve the same dramatic objective so each clip feels unified rather than stitched together\n"
            "- Give the internal subshots an editorial spine: entry hook, development, escalation, exit bridge\n"
            "- Make each cut motivated by action, eyeline, reaction, sound cue, movement, power shift, or information reveal rather than arbitrary angle changes\n"
            "- If dialogue or monologue exists, the subshots must protect performance continuity: cut around speaker emphasis, listener reaction, pauses, interruptions, subtext, and status changes rather than shredding the line unnaturally\n"
            "- Use close-up / over-shoulder / reaction / insert coverage to strengthen dialogue beats, but do not let camera variation overpower or derail the spoken content\n"
            "- The opening shots should enter quickly into the meaningful scene, dialogue, confrontation, or event beat instead of long setup exposition\n"
            "- Carry forward continuity from the previous clip: the first subshot should inherit the prior clip's state, eyeline, motion, or sound tail when relevant\n"
            "- Build handoff continuity to the next clip: the last subshot should end on a natural editorial bridge rather than an abrupt stop\n"
            "- Do not let the ending of the current clip and the opening of the next clip become a duplicate replay of the same beat\n"
            "- Prefer bridges such as match-on-action, carried eyeline, prop interaction, reaction hold, direction-of-motion continuity, or a sound bridge\n"
            "- Include a concrete `continuity_note` on the shot and script_segment\n"
            "- `lighting_mood` must describe practical light source, color tone, contrast, and atmosphere in a shootable way\n"
            "- `sound_effects` must describe the key editorial sound layer for the shot in a concrete way\n"
            "- `dialogue` may be an empty string if the shot should stay silent or rely only on montage / sound design\n"
            "- Keep spoken dialogue brief, playable, and lip-syncable inside the actual clip duration\n"
            "- Use the package-level `audio` guidance for integrated dialogue / ambience / optional BGM inside the video itself, not as a separate required pipeline\n"
            "- Keep user-facing fields in the user's language\n"
            "- Fields ending in `_en` must be English\n"
            "- Preserve the global `aspect_ratio` selected by the master overview\n"
            "- If the user requested short-drama adaptation, make the shot read like a finished short-drama beat with precise action/expression/camera progression rather than a plot summary\n"
            "- If the user requested character-sheet or pure-scene extraction behavior, reflect those requirements in relevant world refs, visual details, and prompt wording instead of dropping them\n"
            "- When three-view character modeling exists in the package, use it to lock identity and wardrobe consistency, but do NOT turn this narrative shot into a model sheet, white background lineup, or front/side/back presentation\n"
            "- Reuse exact world ids from bible.elements in `world_refs`\n"
            "- Include binding_lock, subshots, and video_primary_world_ref\n"
            "- Preserve original names/IP/plot facts exactly\n\n"
            f"MASTER OVERVIEW JSON:\n{json.dumps(compact_overview, ensure_ascii=False)}\n\n"
            f"CURRENT BLUEPRINT BATCH JSON:\n{json.dumps(batch_blueprints, ensure_ascii=False)}\n\n"
            f"PREVIOUS BLUEPRINT JSON:\n{json.dumps(prev_blueprint or {}, ensure_ascii=False)}\n\n"
            f"NEXT BLUEPRINT JSON:\n{json.dumps(next_blueprint or {}, ensure_ascii=False)}\n\n"
            f"RECENT SHOT SUMMARIES:\n{continuity_context or '- none'}"
        ).strip()
        try:
            shot_result = await _generate_structured_with_openrouter(
                prompt=shot_prompt,
                output_schema=batch_schema,
                preferred_language=preferred_language,
                preferred_language_instruction=preferred_language_instruction,
                max_tokens=max_tokens,
                model_retries=model_retries,
                transport_retries=transport_retries,
                http_timeout_seconds=http_timeout_seconds,
                model_timeout_seconds=model_timeout_seconds,
            )
            chunk = shot_result.get("structured_output")
            if not isinstance(chunk, dict):
                raise ValueError(
                    f"Storyboard shot batch {batch_start + 1}-{batch_end} generation did not return an object"
                )
            normalized_batch = _normalize_storyboard_batch_chunk(
                chunk=chunk,
                blueprints=batch_blueprints,
            )
        except Exception as batch_error:
            if workflow_state_callback:
                await workflow_state_callback(
                    _build_storyboard_workflow_state(
                        request_fingerprint=request_fingerprint,
                        phase="failed",
                        status="failed",
                        total_shots=total_shots,
                        completed_shots=len(shot_results),
                        restored_shots=len(shot_results),
                        current_batch={**current_batch, "status": "failed"},
                        failed_batch={**current_batch, "status": "failed"},
                        attempt=attempt,
                        max_attempts=max_attempts,
                        error=str(batch_error),
                    )
                )
            raise
        for normalized_chunk in normalized_batch:
            await _upsert_script_draft_asset(
                canvas_id=canvas_id,
                session_id=session_id,
                user_id=user_id,
                normalized_chunk=normalized_chunk,
                request_fingerprint=request_fingerprint,
                total_shots=total_shots,
            )
            shot_results.append(normalized_chunk)
            if normalized_chunk.get("brief_summary"):
                recent_summaries.append(normalized_chunk["brief_summary"])
        checkpoint["overview"] = copy.deepcopy(overview)
        checkpoint["blueprints"] = copy.deepcopy(blueprints)
        checkpoint["shot_results"] = copy.deepcopy(shot_results)
        checkpoint["recent_summaries"] = list(recent_summaries)
        cache_storyboard_checkpoint(
            canvas_id=canvas_id,
            session_id=session_id,
            request_fingerprint=request_fingerprint,
            checkpoint=checkpoint,
        )
        await progress_callback(
            _structured_progress_message(
                "batch_done",
                preferred_language,
                start=batch_start + 1,
                end=batch_end,
                done=len(shot_results),
                total=total_shots,
                summary=_checkpoint_recent_summary(recent_summaries),
            )
        )
        if workflow_state_callback:
            next_batch = None
            if len(shot_results) < total_shots:
                next_batch = {
                    "startShot": len(shot_results) + 1,
                    "endShot": min(total_shots, len(shot_results) + SHOT_DETAIL_BATCH_SIZE),
                    "status": "pending",
                }
            await workflow_state_callback(
                _build_storyboard_workflow_state(
                    request_fingerprint=request_fingerprint,
                    phase="shot_queue",
                    status="running",
                    total_shots=total_shots,
                    completed_shots=len(shot_results),
                    restored_shots=len(shot_results),
                    current_batch=next_batch,
                    attempt=attempt,
                    max_attempts=max_attempts,
                    summary=_checkpoint_recent_summary(recent_summaries),
                )
            )

    await progress_callback(_structured_progress_message("assemble", preferred_language))
    if workflow_state_callback:
        await workflow_state_callback(
            _build_storyboard_workflow_state(
                request_fingerprint=request_fingerprint,
                phase="assemble",
                status="running",
                total_shots=total_shots,
                completed_shots=len(shot_results),
                restored_shots=len(shot_results),
                attempt=attempt,
                max_attempts=max_attempts,
            )
        )
    final_output: Dict[str, Any] = {
        key: copy.deepcopy(value)
        for key, value in overview.items()
        if key != "shot_blueprints"
    }
    final_output["shots"] = [item["shot"] for item in shot_results]
    final_output["script_segments"] = [item["script_segment"] for item in shot_results]
    if isinstance(final_output.get("story_metrics"), dict):
        final_output["story_metrics"]["clip_count"] = len(final_output["shots"])
        final_output["story_metrics"]["clip_architecture"] = {
            "pattern": "anchor_5s/story_15s",
            "anchor_duration_seconds": BRIDGE_VIDEO_DURATION_SECONDS,
            "story_duration_seconds": MAIN_VIDEO_DURATION_SECONDS,
        }
    if final_output["shots"]:
        final_output["total_duration_seconds"] = final_output["shots"][-1].get("end_sec") or final_output.get("total_duration_seconds")
    missing_fields = _get_missing_required_fields(final_output, output_schema)
    if missing_fields:
        final_output = await _repair_missing_required_fields(
            prompt=prompt,
            output_schema=output_schema,
            partial_output=final_output,
            missing_fields=missing_fields,
            preferred_language=preferred_language,
            preferred_language_instruction=preferred_language_instruction,
            max_tokens=max_tokens,
            model_retries=model_retries,
            transport_retries=transport_retries,
            http_timeout_seconds=http_timeout_seconds,
            model_timeout_seconds=model_timeout_seconds,
            progress_callback=progress_callback,
        )
    _validate_required_fields(final_output, output_schema)
    clear_storyboard_checkpoint(
        canvas_id=canvas_id,
        session_id=session_id,
        request_fingerprint=request_fingerprint,
    )
    if workflow_state_callback:
        await workflow_state_callback(
            _build_storyboard_workflow_state(
                request_fingerprint=request_fingerprint,
                phase="completed",
                status="completed",
                total_shots=total_shots,
                completed_shots=len(shot_results),
                restored_shots=len(shot_results),
                attempt=attempt,
                max_attempts=max_attempts,
                summary=_checkpoint_recent_summary(recent_summaries),
            )
        )
    return {"structured_output": final_output}


def normalize_json_schema_types(schema: Any) -> Any:
    """Normalize legacy JSON schema type strings to standard JSON Schema types."""
    if isinstance(schema, list):
        return [normalize_json_schema_types(item) for item in schema]
    if not isinstance(schema, dict):
        return schema

    normalized = {}
    for k, v in schema.items():
        if k == "type" and isinstance(v, str):
            type_map = {
                "STRING": "string",
                "NUMBER": "number",
                "INTEGER": "integer",
                "OBJECT": "object",
                "ARRAY": "array",
                "BOOLEAN": "boolean",
                "NULL": "null",
            }
            normalized[k] = type_map.get(v, v.lower())
        else:
            normalized[k] = normalize_json_schema_types(v)
    return normalized


def _extract_json(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    m = re.search(r"(\{.*\}|\[.*\])", cleaned, flags=re.DOTALL)
    return (m.group(1) if m else cleaned).strip()


def _validate_required_fields(output: Any, schema: Dict[str, Any]) -> None:
    if _schema_expects_object(schema) and not isinstance(output, dict):
        raise ValueError(
            f"Structured output root must be an object for this schema, got {type(output).__name__}"
        )
    if not isinstance(output, dict):
        return
    required = _as_dict(schema).get("required") or []
    if not isinstance(required, list):
        return
    missing = [k for k in required if k not in output]
    if missing:
        raise ValueError(f"Structured output missing required fields: {missing}")


def _get_missing_required_fields(output: Any, schema: Dict[str, Any]) -> list[str]:
    required = _as_dict(schema).get("required") or []
    if not isinstance(required, list):
        return []
    if not isinstance(output, dict):
        return [str(k) for k in required]
    return [str(k) for k in required if k not in output]


async def _repair_missing_required_fields(
    *,
    prompt: str,
    output_schema: Dict[str, Any],
    partial_output: Dict[str, Any],
    missing_fields: list[str],
    preferred_language: str,
    preferred_language_instruction: str,
    max_tokens: int,
    model_retries: int,
    transport_retries: int,
    http_timeout_seconds: int,
    model_timeout_seconds: int,
    progress_callback,
) -> Dict[str, Any]:
    if not missing_fields:
        return partial_output

    merged = copy.deepcopy(partial_output)
    remaining = list(missing_fields)

    for repair_attempt in range(1, MAX_MISSING_FIELD_REPAIR_ATTEMPTS + 1):
        await progress_callback(
            _structured_progress_message(
                "repair_missing",
                preferred_language,
                attempt=repair_attempt,
                max_attempts=MAX_MISSING_FIELD_REPAIR_ATTEMPTS,
                fields=", ".join(remaining),
            )
        )

        repair_schema = {
            "type": "object",
            "required": remaining,
            "properties": {
                key: copy.deepcopy(_as_dict(_as_dict(output_schema).get("properties")).get(key, {"type": "object"}))
                for key in remaining
            },
        }

        repair_prompt = (
            "The previous structured storyboard output is missing required top-level fields.\n"
            "Return ONLY the missing fields as valid JSON matching the provided schema.\n"
            "Do not repeat fields that already exist.\n"
            "Preserve the exact same story, names, language, and continuity.\n\n"
            f"ORIGINAL REQUEST:\n{prompt.strip()}\n\n"
            f"CURRENT PARTIAL OUTPUT:\n{json.dumps(merged, ensure_ascii=False)}\n\n"
            f"MISSING REQUIRED FIELDS:\n{json.dumps(remaining, ensure_ascii=False)}"
        ).strip()

        repaired = await _generate_structured_with_openrouter(
            prompt=repair_prompt,
            output_schema=repair_schema,
            preferred_language=preferred_language,
            preferred_language_instruction=preferred_language_instruction,
            max_tokens=max_tokens,
            model_retries=model_retries,
            transport_retries=transport_retries,
            http_timeout_seconds=http_timeout_seconds,
            model_timeout_seconds=model_timeout_seconds,
        )

        repaired_output = repaired.get("structured_output")
        if not isinstance(repaired_output, dict):
            raise ValueError(f"Structured field repair did not return an object for missing fields: {remaining}")

        for field in remaining:
            if field in repaired_output:
                merged[field] = repaired_output[field]

        remaining = _get_missing_required_fields(merged, output_schema)
        if not remaining:
            return merged

    raise ValueError(f"Structured output missing required fields after targeted repairs: {remaining}")


_DURATION_RE = re.compile(
    r"\bduration\s*[:=]?\s*(?:5|15)(?:\s*(?:s|sec|secs|second|seconds))?\b",
    re.IGNORECASE,
)

_DURATION_SUFFIX_RE = re.compile(
    r"\s*\(?\s*duration\s*[:=]?\s*(?:5|15)(?:\s*(?:s|sec|secs|second|seconds))?\s*\)?\s*$",
    re.IGNORECASE,
)


def _ensure_duration_phrase(text: str, *, duration_seconds: int = CANONICAL_VIDEO_DURATION_SECONDS) -> str:
    if not isinstance(text, str):
        return text
    without_suffix = _DURATION_SUFFIX_RE.sub("", text).strip()
    if _DURATION_RE.search(without_suffix):
        return without_suffix
    if _DURATION_RE.search(text):
        return text

    # Keep prompts consistent: always use `duration: N` (no "s") as a plain phrase.
    # Prefer appending with a comma to avoid changing semantics.
    return text.rstrip().rstrip(".") + f", duration: {duration_seconds}"


def _enforce_video_duration_in_prompts(structured_output: Any) -> Any:
    """
    Ensure every shot prompt explicitly mentions the architecture duration for that shot.
    This is purely prompt-level; actual duration is enforced in video/audio tools.
    """
    if not isinstance(structured_output, dict):
        return structured_output
    shots = structured_output.get("shots")
    if not isinstance(shots, list):
        return structured_output

    for shot in shots:
        if not isinstance(shot, dict):
            continue
        duration_seconds = _safe_int(shot.get("duration_seconds"), CANONICAL_VIDEO_DURATION_SECONDS)
        clip_role = str(shot.get("clip_role") or "").strip()
        if clip_role == "anchor_5s":
            duration_seconds = BRIDGE_VIDEO_DURATION_SECONDS
        elif clip_role == "story_15s":
            duration_seconds = MAIN_VIDEO_DURATION_SECONDS
        for key in (
            "motion_prompt_en",
            "visual_prompt_en",
            "keyframe_prompt_en",
            "keyframe_edit_prompt_en",
        ):
            if key in shot and isinstance(shot.get(key), str):
                shot[key] = _ensure_duration_phrase(shot[key], duration_seconds=duration_seconds)
        # For FLF, these prompts often get used to generate the two keyframes; still keep duration context explicit.
        for key in ("first_frame_prompt_en", "last_frame_prompt_en"):
            if key in shot and isinstance(shot.get(key), str):
                shot[key] = _ensure_duration_phrase(shot[key], duration_seconds=duration_seconds)

    return structured_output


async def _noop_progress_callback(_: str) -> None:
    return None


async def _generate_structured_with_openrouter(
    prompt: str,
    output_schema: Dict[str, Any],
    preferred_language: str | None = None,
    preferred_language_instruction: str | None = None,
    max_tokens: int = MIN_STRUCTURED_OUTPUT_MAX_TOKENS,
    model_retries: int = DEFAULT_STRUCTURED_MODEL_RETRIES,
    transport_retries: int = 3,
    http_timeout_seconds: int = DEFAULT_STRUCTURED_HTTP_TIMEOUT_SECONDS,
    model_timeout_seconds: int = DEFAULT_STRUCTURED_MODEL_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    openrouter_config = config_service.get_service_config("openrouter") or {}
    base_url = openrouter_config.get("url") or "https://openrouter.ai/api/v1"
    api_key = openrouter_config.get("api_key")
    if not api_key:
        raise ValueError("OpenRouter api_key missing in config.toml [openrouter]")

    transport_limits = httpx.Limits(
        max_keepalive_connections=0,
        max_connections=20,
        keepalive_expiry=0.0,
    )
    http_client = HttpClient.create_sync_client(
        url=base_url,
        timeout=http_timeout_seconds,
        http2=False,
        limits=transport_limits,
        headers={"Connection": "close"},
    )
    http_async_client = HttpClient.create_async_client(
        url=base_url,
        timeout=http_timeout_seconds,
        http2=False,
        limits=transport_limits,
        headers={"Connection": "close"},
    )

    extra_headers = {
        "HTTP-Referer": openrouter_config.get("site_url", "https://reelmind.ai"),
        "X-Title": openrouter_config.get("site_name", "ReelMind"),
    }

    # Always follow config.toml's default OpenRouter model to keep behavior consistent.
    configured_model_name = openrouter_config.get("model") or "google/gemini-3.1-pro-preview"

    model = ChatOpenAI(
        model=configured_model_name,
        api_key=api_key,
        base_url=base_url,
        timeout=model_timeout_seconds,
        max_retries=model_retries,
        max_tokens=max_tokens,
        temperature=0.2,
        http_client=http_client,
        http_async_client=http_async_client,
        default_headers=extra_headers,
    )

    language_rules = (preferred_language_instruction or "").strip()
    if preferred_language:
        default_language_rule = (
            f"Preferred language for all user-facing JSON string fields is {preferred_language}. "
            "This includes title, premise, style, screenplay.text, screenplay.summary, "
            "bible element names/descriptions, and script segment text. "
            "Fields ending in `_en` must stay in English because they are generation prompts. "
            "Preserve the user's source IP, character names, place names, and terminology exactly; "
            "do not rename, translate, or replace them unless the prompt explicitly requests that."
        )
        language_rules = f"{language_rules}\n{default_language_rule}".strip()

    system = (
        "You are a JSON generator.\n"
        "Return ONLY valid JSON that strictly conforms to the provided JSON Schema.\n"
        "No markdown, no code fences, no commentary, no trailing text.\n"
        "Do not add extra keys.\n"
        + (f"{language_rules}\n\n" if language_rules else "\n")
        + (
        f"JSON Schema:\n{json.dumps(output_schema, ensure_ascii=False)}"
        )
    )

    try:
        last_text = ""
        last_err: Optional[Exception] = None

        for attempt in range(2):
            if attempt == 0:
                messages = [SystemMessage(content=system), HumanMessage(content=prompt)]
            else:
                messages = [
                    SystemMessage(content=system),
                    HumanMessage(
                        content=(
                            "Fix the following into STRICTLY valid JSON that matches the schema. "
                            "Return JSON ONLY.\n\n"
                            f"Invalid output:\n{last_text}"
                        )
                    ),
                ]

            last_transport_err: Optional[Exception] = None
            resp = None
            for transport_attempt in range(1, max(1, transport_retries) + 1):
                try:
                    resp = await model.ainvoke(messages)
                    last_transport_err = None
                    break
                except RETRYABLE_HTTPX_ERRORS as e:
                    last_transport_err = e
                    if transport_attempt >= max(1, transport_retries):
                        raise
                    await asyncio.sleep(0.8 * transport_attempt)
            if resp is None and last_transport_err is not None:
                raise last_transport_err
            last_text = getattr(resp, "content", "") or ""

            try:
                structured_output = json.loads(_extract_json(last_text))
                if _schema_expects_object(output_schema) and not isinstance(structured_output, dict):
                    raise ValueError(
                        f"Structured JSON root must be an object, got {type(structured_output).__name__}"
                    )
                missing_fields = _get_missing_required_fields(structured_output, output_schema)
                if missing_fields:
                    structured_output = await _repair_missing_required_fields(
                        prompt=prompt,
                        output_schema=output_schema,
                        partial_output=structured_output,
                        missing_fields=missing_fields,
                        preferred_language=preferred_language or "",
                        preferred_language_instruction=preferred_language_instruction or "",
                        max_tokens=max_tokens,
                        model_retries=model_retries,
                        transport_retries=transport_retries,
                        http_timeout_seconds=http_timeout_seconds,
                        model_timeout_seconds=model_timeout_seconds,
                        progress_callback=_noop_progress_callback,
                    )
                _validate_required_fields(structured_output, output_schema)
                return {"structured_output": structured_output, "raw_text": last_text}
            except Exception as e:
                last_err = e
                continue

        raise ValueError(f"Failed to parse/validate structured JSON: {last_err}")
    finally:
        try:
            await http_async_client.aclose()
        finally:
            http_client.close()


@tool(args_schema=GenerateStructuredOutputInputSchema)
async def generate_structured_output(
    prompt: str,
    output_schema: Dict[str, Any],
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    response_format: Optional[Any] = "json",
) -> str:
    """
    Generate structured output using OpenRouter (per config.toml).
    """
    canvas_id = config.get("configurable", {}).get("canvas_id")
    session_id = config.get("configurable", {}).get("session_id")
    user_id = config.get("configurable", {}).get("user_id")
    if not canvas_id or not session_id:
        return "❌ " + _structured_progress_message(
            "failed",
            "",
            error="Canvas ID and Session ID are required",
        )

    normalized_schema = normalize_json_schema_types(output_schema)
    configurable = config.get("configurable", {}) or {}
    preferred_language = str(configurable.get("preferred_language") or "").strip()
    preferred_language_instruction = str(configurable.get("preferred_language_instruction") or "").strip()
    effective_prompt = _augment_prompt_with_runtime_media_context(prompt, configurable)
    try:
        delegated = await _try_delegate_structured_output_to_acp(
            prompt=effective_prompt,
            output_schema=normalized_schema,
            config=config,
            response_format=response_format,
        )
        if delegated:
            log_runtime_event(
                "structured_output.delegated",
                canvas_id=canvas_id,
                session_id=session_id,
                user_id=user_id,
            )
            return delegated
    except Exception as bridge_exc:
        log_runtime_warning(
            "structured_output.delegation_failed_fallback_local",
            canvas_id=canvas_id,
            session_id=session_id,
            user_id=user_id,
            error=str(bridge_exc),
        )

    # The model used is always the OpenRouter configured model for consistency.
    openrouter_config = config_service.get_service_config("openrouter") or {}
    configured_model_name = openrouter_config.get("model") or "google/gemini-3.1-pro-preview"
    configured_max_tokens = int(openrouter_config.get("max_tokens", 8192) or 8192)
    structured_max_tokens = int(
        openrouter_config.get("structured_output_max_tokens", max(configured_max_tokens, MIN_STRUCTURED_OUTPUT_MAX_TOKENS))
        or max(configured_max_tokens, MIN_STRUCTURED_OUTPUT_MAX_TOKENS)
    )
    structured_attempts = int(
        openrouter_config.get("structured_output_attempts", DEFAULT_STRUCTURED_OUTPUT_ATTEMPTS)
        or DEFAULT_STRUCTURED_OUTPUT_ATTEMPTS
    )
    structured_attempts = max(1, structured_attempts)
    structured_model_retries = int(
        openrouter_config.get("structured_output_model_retries", DEFAULT_STRUCTURED_MODEL_RETRIES)
        or DEFAULT_STRUCTURED_MODEL_RETRIES
    )
    structured_transport_retries = int(
        openrouter_config.get("structured_output_transport_retries", 3) or 3
    )
    structured_http_timeout_seconds = int(
        openrouter_config.get("structured_output_http_timeout_seconds", DEFAULT_STRUCTURED_HTTP_TIMEOUT_SECONDS)
        or DEFAULT_STRUCTURED_HTTP_TIMEOUT_SECONDS
    )
    structured_model_timeout_seconds = int(
        openrouter_config.get("structured_output_model_timeout_seconds", DEFAULT_STRUCTURED_MODEL_TIMEOUT_SECONDS)
        or DEFAULT_STRUCTURED_MODEL_TIMEOUT_SECONDS
    )

    log_runtime_event(
        "structured_output.requested",
        prompt=f"{effective_prompt[:120]}..." if len(effective_prompt) > 120 else effective_prompt,
        model=configured_model_name,
        max_tokens=structured_max_tokens,
        http_timeout_seconds=structured_http_timeout_seconds,
        model_timeout_seconds=structured_model_timeout_seconds,
        preferred_language=preferred_language,
    )

    if user_id:
        await send_session_update(user_id, session_id, canvas_id, {
            "type": "tool_call_progress",
            "tool_call_id": tool_call_id,
            "update": _structured_progress_message("generate_storyboard", preferred_language),
        })

    storyboard_request_fingerprint = (
        _storyboard_request_fingerprint(
            prompt=effective_prompt,
            output_schema=normalized_schema,
            preferred_language=preferred_language,
        )
        if _is_storyboard_schema(normalized_schema)
        else ""
    )
    max_attempts = structured_attempts
    last_err: Exception | None = None

    async def _emit_progress(update: str) -> None:
        if user_id:
            await send_session_update(user_id, session_id, canvas_id, {
                "type": "tool_call_progress",
                "tool_call_id": tool_call_id,
                "update": update,
            })

    async def _emit_workflow_state(state: dict[str, Any]) -> None:
        if user_id:
            await send_session_update(user_id, session_id, canvas_id, {
                "type": "tool_call_workflow_state",
                "tool_call_id": tool_call_id,
                "workflow": state,
            })

    async def _emit_retry_review(error: str, *, attempt: int, max_attempts: int) -> None:
        if user_id:
            await send_session_update(
                user_id,
                session_id,
                canvas_id,
                {
                    "type": "review",
                    "layer": "script",
                    "status": "attention_needed",
                    "score": 42,
                    "summary": (
                        f"Storyboard JSON attempt {attempt}/{max_attempts} failed. "
                        "NolanX is retrying automatically."
                    ),
                    "detail": error,
                    "target_kind": "structured_output",
                    "target_id": storyboard_request_fingerprint or tool_call_id,
                    "prompt_excerpt": effective_prompt[:220],
                },
            )

    for attempt in range(1, max_attempts + 1):
        try:
            if attempt > 1:
                await _emit_progress(
                    _structured_progress_message(
                        "retry_storyboard",
                        preferred_language,
                        attempt=attempt,
                        max_attempts=max_attempts,
                    )
                )
                if storyboard_request_fingerprint:
                    await _emit_workflow_state(
                        _build_storyboard_workflow_state(
                            request_fingerprint=storyboard_request_fingerprint,
                            phase="retrying",
                            status="retrying",
                            total_shots=0,
                            completed_shots=0,
                            attempt=attempt,
                            max_attempts=max_attempts,
                            error=str(last_err) if last_err else None,
                        )
                    )
            if _is_storyboard_schema(normalized_schema):
                result = await _generate_storyboard_iteratively(
                    prompt=effective_prompt,
                    output_schema=normalized_schema,
                    canvas_id=canvas_id,
                    session_id=session_id,
                    user_id=user_id,
                    preferred_language=preferred_language,
                    preferred_language_instruction=preferred_language_instruction,
                    max_tokens=structured_max_tokens,
                    model_retries=structured_model_retries,
                    transport_retries=structured_transport_retries,
                    http_timeout_seconds=structured_http_timeout_seconds,
                    model_timeout_seconds=structured_model_timeout_seconds,
                    progress_callback=_emit_progress,
                    workflow_state_callback=_emit_workflow_state,
                    attempt=attempt,
                    max_attempts=max_attempts,
                )
            else:
                result = await _generate_structured_with_openrouter(
                    prompt=effective_prompt,
                    output_schema=normalized_schema,
                    preferred_language=preferred_language,
                    preferred_language_instruction=preferred_language_instruction,
                    max_tokens=structured_max_tokens,
                    model_retries=structured_model_retries,
                    transport_retries=structured_transport_retries,
                    http_timeout_seconds=structured_http_timeout_seconds,
                    model_timeout_seconds=structured_model_timeout_seconds,
                )
            result["structured_output"] = _enforce_video_duration_in_prompts(result.get("structured_output"))
            if not isinstance(result["structured_output"], dict):
                raise ValueError(
                    f"Structured output root must be an object before caching, got {type(result['structured_output']).__name__}"
                )
            fingerprint = cache_latest_structured_output(
                canvas_id=canvas_id,
                session_id=session_id,
                structured_output=result["structured_output"],
            )
            if user_id:
                await send_session_update(user_id, session_id, canvas_id, {
                    "type": "tool_call_progress",
                    "tool_call_id": tool_call_id,
                    "update": _structured_progress_message("handoff", preferred_language),
                })
            summary = {
                "title": result["structured_output"].get("title"),
                "total_duration_seconds": result["structured_output"].get("total_duration_seconds"),
                "clip_count": len(result["structured_output"].get("shots") or []),
                "fingerprint": fingerprint,
            }
            success_message = "📊 Structured output generated successfully - Provider: OpenRouter"
            success_message += (
                "\n\n**Structured Output Cached:**\n```json\n"
                + json.dumps(summary, indent=2, ensure_ascii=False)
                + "\n```"
            )
            return success_message
        except Exception as e:
            last_err = e
            log_runtime_warning(
                "structured_output.attempt.failed",
                attempt=attempt,
                max_attempts=max_attempts,
                error=str(e),
            )
            if attempt < max_attempts:
                retry_update = _structured_progress_message(
                    "attempt_failed_retrying",
                    preferred_language,
                    attempt=attempt,
                    max_attempts=max_attempts,
                    error=str(e),
                )
                await _emit_progress(retry_update)
                await _emit_retry_review(str(e), attempt=attempt, max_attempts=max_attempts)
                await asyncio.sleep(0.6 * (2 ** (attempt - 1)))
                continue
            break

    if storyboard_request_fingerprint:
        await _emit_workflow_state(
            _build_storyboard_workflow_state(
                request_fingerprint=storyboard_request_fingerprint,
                phase="failed",
                status="failed",
                total_shots=0,
                completed_shots=0,
                attempt=max_attempts,
                max_attempts=max_attempts,
                error=str(last_err) if last_err else "Unknown error",
            )
        )
    if user_id:
        await send_session_update(user_id, session_id, canvas_id, {
            "type": "error",
            "error": _structured_progress_message(
                "failed",
                preferred_language,
                error=str(last_err) if last_err else "Unknown error",
            )
        })
    return "❌ " + _structured_progress_message(
        "failed",
        preferred_language,
        error=str(last_err) if last_err else "Unknown error",
    )
