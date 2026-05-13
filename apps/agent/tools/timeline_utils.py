"""
Timeline utilities for asset generation tools.
Provides common functions for creating and managing timeline data structure.
"""

from __future__ import annotations

import time
import uuid
import datetime
from typing import Any


def generate_file_id():
    """生成唯一文件ID"""
    return str(uuid.uuid4())


def _truncate_text(text: str, limit: int = 180) -> str:
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: limit - 3].rstrip() + "..."


def _pick_prompt_text(prompt: str | None = None, metadata: dict | None = None, fallback: str = "") -> str:
    if str(prompt or "").strip():
        return str(prompt).strip()
    meta = metadata or {}
    for key in (
        "prompt",
        "videoPromptEn",
        "basePromptEn",
        "storyboardPrompt",
        "visualPromptEn",
        "motionPromptEn",
        "description",
        "text",
    ):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(fallback or "").strip()


def _build_prompt_review(*, layer: str, prompt: str, metadata: dict | None = None) -> dict[str, Any]:
    text = str(prompt or "").strip()
    checks: list[dict[str, str]] = []
    suggested_actions: list[str] = []
    score = 100

    if not text:
        score -= 45
        checks.append({"name": "prompt_presence", "status": "warning", "detail": "No explicit prompt was stored."})
        suggested_actions.append("Persist the final resolved prompt for this layer before generation.")
    else:
        checks.append({"name": "prompt_presence", "status": "ok", "detail": "Prompt captured in asset metadata."})

    if text and len(text) < 48:
        score -= 18
        checks.append({"name": "prompt_specificity", "status": "warning", "detail": "Prompt is short and may underspecify shot/style constraints."})
        suggested_actions.append("Add stronger visual, continuity, and emotional constraints to the prompt.")
    elif text:
        checks.append({"name": "prompt_specificity", "status": "ok", "detail": "Prompt length suggests enough room for concrete constraints."})

    if text and "@" not in text and "ref" not in text.lower() and "continuity" not in text.lower():
        score -= 10
        checks.append({"name": "reference_binding", "status": "warning", "detail": "Prompt has no explicit continuity/reference anchor language."})
        suggested_actions.append("Add explicit character/world/continuity anchors when consistency matters.")
    else:
        checks.append({"name": "reference_binding", "status": "ok", "detail": "Prompt includes continuity or reference-style cues."})

    if layer == "audio" and text and '"' not in text and "dialogue" not in text.lower() and "voice" not in text.lower():
        score -= 8
        checks.append({"name": "voice_direction", "status": "warning", "detail": "Audio prompt may be missing explicit voice or delivery direction."})
        suggested_actions.append("Specify voice, pace, mood, and key spoken lines for audio generations.")

    score = max(0, min(100, score))
    status = "approved_auto" if score >= 85 else ("attention_needed" if score < 60 else "needs_review")
    summary = (
        "Prompt captured and looks production-ready."
        if status == "approved_auto"
        else "Prompt has review risks that should be checked before downstream reuse."
    )
    return {
        "layer": layer,
        "status": status,
        "score": score,
        "summary": summary,
        "promptExcerpt": _truncate_text(text, 220),
        "checks": checks,
        "suggestedActions": suggested_actions[:4],
    }


def _build_asset_review(
    *,
    layer: str,
    duration: float | int | None,
    primary_media_url: str | None = None,
    prompt_review: dict[str, Any] | None = None,
    metadata: dict | None = None,
    extra_checks: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    checks: list[dict[str, str]] = list(extra_checks or [])
    suggested_actions: list[str] = []
    score = int((prompt_review or {}).get("score") or 70)

    if primary_media_url:
        checks.append({"name": "primary_media", "status": "ok", "detail": "Primary generated media URL is attached."})
    else:
        score -= 30
        checks.append({"name": "primary_media", "status": "warning", "detail": "No primary media URL is attached yet."})
        suggested_actions.append("Verify the asset has a usable primary media payload before approval.")

    if duration is None or float(duration) <= 0:
        score -= 10
        checks.append({"name": "timeline_duration", "status": "warning", "detail": "Timeline duration is missing or invalid."})
        suggested_actions.append("Set an explicit duration so the asset can be reviewed in sequence.")
    else:
        checks.append({"name": "timeline_duration", "status": "ok", "detail": f"Timeline duration set to {float(duration):g}s."})

    if metadata and metadata.get("reviewNotes"):
        checks.append({"name": "review_notes", "status": "ok", "detail": "Manual review notes already exist."})

    score = max(0, min(100, score))
    status = "approved_auto" if score >= 85 else ("attention_needed" if score < 60 else "needs_review")
    summary = (
        "Asset passed automatic review checks."
        if status == "approved_auto"
        else "Asset should be reviewed before being treated as locked."
    )
    return {
        "layer": layer,
        "status": status,
        "score": score,
        "summary": summary,
        "checks": checks,
        "suggestedActions": suggested_actions[:4],
    }


def _attach_review_metadata(
    *,
    layer: str,
    metadata: dict,
    prompt: str,
    duration: float | int | None,
    primary_media_url: str | None,
    extra_checks: list[dict[str, str]] | None = None,
) -> None:
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    prompt_review = _build_prompt_review(layer=layer, prompt=prompt, metadata=metadata)
    asset_review = _build_asset_review(
        layer=layer,
        duration=duration,
        primary_media_url=primary_media_url,
        prompt_review=prompt_review,
        metadata=metadata,
        extra_checks=extra_checks,
    )
    metadata.setdefault("prompt", prompt)
    metadata["review"] = {
        "version": 1,
        "generatedAt": current_time,
        "layer": layer,
        "status": asset_review["status"],
        "score": asset_review["score"],
        "summary": asset_review["summary"],
        "promptReview": prompt_review,
        "assetReview": asset_review,
    }


def build_review_event_from_asset(asset: dict[str, Any]) -> dict[str, Any] | None:
    metadata = asset.get("metadata") or {}
    review = metadata.get("review") or {}
    if not isinstance(review, dict):
        return None
    prompt_review = review.get("promptReview") or {}
    return {
        "type": "review",
        "layer": str(review.get("layer") or asset.get("type") or "asset"),
        "status": str(review.get("status") or "needs_review"),
        "score": review.get("score"),
        "summary": str(review.get("summary") or "Automatic review completed."),
        "detail": str((review.get("assetReview") or {}).get("summary") or ""),
        "target_kind": str(asset.get("type") or "asset"),
        "target_id": str(asset.get("id") or ""),
        "prompt_excerpt": str(prompt_review.get("promptExcerpt") or ""),
    }


# 移除create_default_timeline函数，因为完整timeline应该由reelmind.server管理


# 移除timeline操作函数，因为这些应该由reelmind.server和前端处理


def create_keyframe_asset(
    file_id,
    public_url,
    width,
    height,
    mime_type,
    prompt="",
    duration=8,
    start_time=None,
    storyboard: dict | None = None,
):
    """创建keyframe资产数据，startTime设为null，由前端计算"""
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    asset = {
        "id": f"keyframe-{file_id}",
        "type": "keyframe",
        "status": "ready",
        "content": {
            "title": "image asset",
            "width": width,
            "height": height,
            "imageUrl": public_url,
            "mimeType": mime_type,
            "description": prompt[:100] if prompt else "",
            "thumbnailUrl": public_url
        },
        "duration": duration,
        "startTime": start_time,  # None => 由前端计算并更新
        "metadata": {
            "fileId": file_id,
            "lastEdited": current_time,
            "editHistory": [
                {
                    "action": "created",
                    "source": "ai_generation",
                    "newValue": {
                        "duration": duration,
                        "startTime": None,  # 由前端计算
                        "resourceUrl": public_url,
                        "thumbnailUrl": public_url
                    },
                    "timestamp": current_time
                }
            ],
            "resourceUrl": public_url,
            "originalSize": {
                "width": width,
                "height": height
            },
            "thumbnailUrl": public_url,
            "addedToTimeline": current_time,
            "canvasElementId": file_id,
            "originalCreated": int(time.time() * 1000),
            "originalPosition": {
                "x": 20,
                "y": 0
            }
        },
        "created_at": current_time,
        "updated_at": current_time
    }
    if storyboard:
        asset["metadata"]["storyboard"] = storyboard
    _attach_review_metadata(
        layer="keyframe",
        metadata=asset["metadata"],
        prompt=_pick_prompt_text(prompt=prompt, metadata=asset["metadata"], fallback=asset["content"].get("description") or ""),
        duration=duration,
        primary_media_url=public_url,
        extra_checks=[
            {
                "name": "image_dimensions",
                "status": "ok" if int(width or 0) > 0 and int(height or 0) > 0 else "warning",
                "detail": f"Image dimensions: {width}x{height}." if int(width or 0) > 0 and int(height or 0) > 0 else "Image dimensions are missing.",
            }
        ],
    )
    return asset


def create_video_asset(
    file_id,
    public_url,
    aspect_ratio,
    mime_type,
    input_image_url=None,
    prompt="",
    duration=8,
    start_time=None,
    last_frame_url=None,
    generation_mode="image_to_video",
    reference_image_urls=None,
    reference_video_urls=None,
    storyboard: dict | None = None,
):
    """创建video资产数据，startTime设为null，由前端计算"""
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    ref_urls = []
    for url in (reference_image_urls or []):
        if isinstance(url, str) and url.strip() and url.strip() not in ref_urls:
            ref_urls.append(url.strip())
    ref_video_urls = []
    for url in (reference_video_urls or []):
        if isinstance(url, str) and url.strip() and url.strip() not in ref_video_urls:
            ref_video_urls.append(url.strip())
    if isinstance(input_image_url, str) and input_image_url.strip() and input_image_url.strip() not in ref_urls:
        ref_urls.insert(0, input_image_url.strip())
    poster_url = ref_urls[0] if ref_urls else (input_image_url or public_url)
    asset = {
        "id": f"video-{file_id}",
        "type": "video",
        "status": "ready",
        "content": {
            "title": f"Video Asset",
            "videoUrl": public_url,
            "posterUrl": poster_url,
            "aspectRatio": aspect_ratio,
            "mimeType": mime_type,
            "description": prompt[:100] if prompt else "",
        },
        "duration": duration,
        "startTime": start_time,  # None => 由前端计算并更新
        "metadata": {
            "fileId": file_id,
            "lastEdited": current_time,
            "editHistory": [
                {
                    "action": "created",
                    "source": "ai_generation",
                    "newValue": {
                        "duration": duration,
                        "startTime": None,  # 由前端计算
                        "resourceUrl": public_url,
                        "thumbnailUrl": poster_url
                    },
                    "timestamp": current_time
                }
            ],
            "resourceUrl": public_url,
            "thumbnailUrl": poster_url,
            "addedToTimeline": current_time,
            "canvasElementId": file_id,
            "originalCreated": int(time.time() * 1000),
            "primaryImageUrl": poster_url,
            "imageUrls": ref_urls,
            "inputImageUrl": poster_url,  # legacy field kept for backward compatibility
            "referenceVideoUrls": ref_video_urls,
            "primaryVideoUrl": ref_video_urls[0] if ref_video_urls else None,
            "lastFrameUrl": last_frame_url,
            "generationMode": generation_mode,
            "originalPosition": {
                "x": 100,
                "y": 100
            }
        },
        "created_at": current_time,
        "updated_at": current_time
    }
    if storyboard:
        asset["metadata"]["storyboard"] = storyboard
    _attach_review_metadata(
        layer="video",
        metadata=asset["metadata"],
        prompt=_pick_prompt_text(prompt=prompt, metadata=asset["metadata"], fallback=asset["content"].get("description") or ""),
        duration=duration,
        primary_media_url=public_url,
        extra_checks=[
            {
                "name": "reference_inputs",
                "status": "ok" if ref_urls or ref_video_urls else "warning",
                "detail": (
                    f"{len(ref_urls)} image refs and {len(ref_video_urls)} video refs attached."
                    if ref_urls or ref_video_urls
                    else "No image/video reference inputs were attached."
                ),
            },
            {
                "name": "generation_mode",
                "status": "ok" if generation_mode else "warning",
                "detail": f"Generation mode: {generation_mode or 'unknown'}.",
            },
        ],
    )
    return asset


def create_audio_asset(file_id, public_url, audio_type, mime_type, prompt="", duration=8, voice=None, **kwargs):
    """创建audio资产数据，startTime设为null，由前端计算"""
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    asset = {
        "id": f"audio-{file_id}",
        "type": "audio",
        "status": "ready",
        "content": {
            "title": f"Audio Asset",
            "audioUrl": public_url,
            "audioType": audio_type,
            "mimeType": mime_type,
            "description": prompt[:100] if prompt else "",
            "voice": voice if audio_type == 'tts' else None,
            **kwargs  # 允许传入额外的属性如bpm, temperature等
        },
        "duration": duration,
        "startTime": None,  # 由前端计算并更新
        "metadata": {
            "fileId": file_id,
            "lastEdited": current_time,
            "editHistory": [
                {
                    "action": "created",
                    "source": "ai_generation",
                    "newValue": {
                        "duration": duration,
                        "startTime": None,  # 由前端计算
                        "resourceUrl": public_url,
                        "audioType": audio_type
                    },
                    "timestamp": current_time
                }
            ],
            "resourceUrl": public_url,
            "addedToTimeline": current_time,
            "canvasElementId": file_id,
            "originalCreated": int(time.time() * 1000),
            "audioType": audio_type,
            "prompt": prompt,
            "voice": voice if audio_type == 'tts' else None,
            "originalPosition": {
                "x": 20,
                "y": 0
            },
            **kwargs
        },
        "created_at": current_time,
        "updated_at": current_time
    }
    _attach_review_metadata(
        layer="audio",
        metadata=asset["metadata"],
        prompt=_pick_prompt_text(prompt=prompt, metadata=asset["metadata"], fallback=asset["content"].get("description") or ""),
        duration=duration,
        primary_media_url=public_url,
        extra_checks=[
            {
                "name": "audio_mode",
                "status": "ok" if audio_type else "warning",
                "detail": f"Audio type: {audio_type or 'unknown'}.",
            },
            {
                "name": "voice_assignment",
                "status": "ok" if audio_type != "tts" or bool(voice) else "warning",
                "detail": f"Voice: {voice}." if voice else "No explicit voice assigned.",
            },
        ],
    )
    return asset


def create_script_asset(
    asset_id: str,
    title: str,
    text: str = "",
    duration: float = 8,
    start_time: float | None = None,
    image_url: str | None = None,
    thumbnail_url: str | None = None,
    metadata: dict | None = None,
):
    """创建script资产数据，可选包含参考图；startTime可由调用方对齐到时间线。"""
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')

    safe_metadata = dict(metadata or {})
    safe_metadata.setdefault("lastEdited", current_time)
    safe_metadata.setdefault(
        "editHistory",
        [
            {
                "action": "created",
                "source": "ai_generation",
                "newValue": {
                    "duration": duration,
                    "startTime": start_time,
                    "title": title,
                    "textPreview": (text or "")[:120],
                },
                "timestamp": current_time,
            }
        ],
    )

    content = {
        "title": title,
        "text": text,
    }
    if image_url:
        content["imageUrl"] = image_url
    if thumbnail_url or image_url:
        content["thumbnailUrl"] = thumbnail_url or image_url

    asset = {
        "id": asset_id,
        "type": "script",
        "status": "ready",
        "content": content,
        "duration": duration,
        "startTime": start_time,
        "metadata": safe_metadata,
        "created_at": current_time,
        "updated_at": current_time,
    }
    _attach_review_metadata(
        layer="script",
        metadata=asset["metadata"],
        prompt=_pick_prompt_text(metadata=asset["metadata"], fallback=text),
        duration=duration,
        primary_media_url=image_url or thumbnail_url,
        extra_checks=[
            {
                "name": "script_text",
                "status": "ok" if str(text or "").strip() else "warning",
                "detail": "Script text is present." if str(text or "").strip() else "Script text is empty.",
            },
            {
                "name": "storyboard_binding",
                "status": "ok" if asset["metadata"].get("storyboardPrompt") or asset["metadata"].get("bindingLock") else "warning",
                "detail": "Storyboard binding metadata attached." if asset["metadata"].get("storyboardPrompt") or asset["metadata"].get("bindingLock") else "No explicit storyboard binding metadata found.",
            },
        ],
    )
    return asset


def create_world_asset(
    asset_id: str,
    code: str,
    name: str,
    description: str = "",
    duration: float = 8,
    start_time: float | None = None,
    image_url: str | None = None,
    video_url: str | None = None,
    thumbnail_url: str | None = None,
    metadata: dict | None = None,
):
    """创建world资产数据（人物/场景/道具等世界观元素），可选包含参考图或参考视频；startTime可由调用方对齐到时间线。"""
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')

    safe_metadata = dict(metadata or {})
    safe_metadata.setdefault("lastEdited", current_time)
    safe_metadata.setdefault(
        "editHistory",
        [
            {
                "action": "created",
                "source": "ai_generation",
                "newValue": {
                    "duration": duration,
                    "startTime": start_time,
                    "code": code,
                    "name": name,
                    "textPreview": (description or "")[:120],
                },
                "timestamp": current_time,
            }
        ],
    )

    content = {
        "title": f"{code} · {name}".strip(" ·"),
        "text": description,
    }
    if image_url:
        content["imageUrl"] = image_url
    if video_url:
        content["videoUrl"] = video_url
    if thumbnail_url or image_url or video_url:
        content["thumbnailUrl"] = thumbnail_url or image_url or video_url

    asset = {
        "id": asset_id,
        "type": "world",
        "status": "ready",
        "content": content,
        "duration": duration,
        "startTime": start_time,
        "metadata": safe_metadata,
        "created_at": current_time,
        "updated_at": current_time,
    }
    _attach_review_metadata(
        layer="world",
        metadata=asset["metadata"],
        prompt=_pick_prompt_text(metadata=asset["metadata"], fallback=description),
        duration=duration,
        primary_media_url=video_url or image_url or thumbnail_url,
        extra_checks=[
            {
                "name": "identity_binding",
                "status": "ok" if code and name else "warning",
                "detail": f"World identity bound to {code} · {name}." if code and name else "World identity is incomplete.",
            },
            {
                "name": "world_description",
                "status": "ok" if str(description or "").strip() else "warning",
                "detail": "World description is present." if str(description or "").strip() else "World description is empty.",
            },
        ],
    )
    return asset
