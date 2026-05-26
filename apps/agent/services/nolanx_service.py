"""
nolanx_service.py

Refactored LangGraph multi-agent service following best practices:
- Clear modular structure
- Separation of configuration and code
- Individual agent definitions
- Improved readability and maintainability

Features:
- Initialize language model clients
- Create and run multi-agent system
- Handle streaming responses
- WebSocket communication
- Message persistence
"""

import json
import re
import traceback
import uuid
from typing import List, Dict, Any, Set, Optional
from langgraph_swarm import create_swarm
from services.websocket_service import send_session_update
from services.message_api_service import create_chat_message, fetch_session_messages
from services.api_client_service import api_client_service

# Import modular components
from .nolanx.config.models import create_llm_model, create_context_config, refresh_context_memory
from .nolanx.config.tools import get_capability_snapshot
from .nolanx.context_files import get_context_file_snapshot, render_context_file_instruction
from .nolanx.memory import get_memory_snapshot, render_memory_instruction
from .nolanx.runtime import get_runtime_components
from .nolanx.skills import filter_skills_for_agent, load_skill_catalog
from .nolanx.agents import (
    create_planner_agent,
    create_script_writer_agent,
    create_image_designer_agent,
    create_image_edit_agent,
    create_audio_designer_agent,
    create_video_designer_agent,
    create_flf_video_designer_agent,
    # create_gemini_veo_designer_agent,
    create_tts_designer_agent,
    create_music_designer_agent,
    create_code_execution_agent,
    create_document_analyzer_agent,
    create_structured_output_agent,
    create_media_analyzer_agent,
    create_function_calling_agent,
    create_web_context_agent,
    create_search_agent
)
from .nolanx.utils.streaming import handle_streaming_response
from .nolanx.utils.prompt_engineering import build_numbered_media_lines
from .nolanx.utils.intent import classify_continuation_intent_with_llm
from services.runtime_logger import (
    log_runtime_event,
    log_runtime_exception,
    log_runtime_warning,
)


TERMINAL_RESUME_STATUSES = {"completed"}
RECOVERABLE_RESUME_STATUSES = {"running", "failed", "interrupted", "cancelled"}
RESUME_TOOL_PRIORITY = [
    "execute_storyboard",
    "generate_structured_output",
    "write_plan",
    "recommend_generation_strategy",
    "analyze_timeline_state",
]
STORYBOARD_CHILD_TOOLS = {
    "generate_image",
    "edit_image",
    "generate_video",
    "generate_video_first_last_frame",
}

RESUME_FORCEABLE_PHASES = {"all", "videos", "video", "world_track", "world", "script_track", "script", "keyframes", "keyframe"}

IMAGE_MARKDOWN_RE = re.compile(r"!\[image_(?:url|id):[^\]]*\]\(([^)]+)\)")
URL_RE = re.compile(r"https?://[^\s)]+", re.IGNORECASE)
IMAGE_EXT_RE = re.compile(r"\.(?:png|jpg|jpeg|webp|gif|bmp|heic|heif)(?:\?|$)", re.IGNORECASE)
VIDEO_EXT_RE = re.compile(r"\.(?:mp4|mov|webm|avi|mkv|m4v)(?:\?|$)", re.IGNORECASE)
AUDIO_EXT_RE = re.compile(r"\.(?:mp3|wav|m4a|aac|flac|ogg)(?:\?|$)", re.IGNORECASE)
SELF_INSERT_RE = re.compile(
    r"(让我|我要|我想|我本人|本人|自己|我自己|我出镜|我出现在|我在剧里|以我为主角|主角是我|按我照片|根据我照片|用我照片|me|myself|i want to be in|put me in|include me|based on my photo)",
    re.IGNORECASE,
)


def _extract_text_content(content: Any) -> str:
    """Extract plain text from OpenAI/LangChain-style message content payloads."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def _looks_like_image_url(url: str) -> bool:
    if not isinstance(url, str):
        return False
    value = url.strip()
    if not value.startswith(("http://", "https://")):
        return False
    return bool(IMAGE_EXT_RE.search(value)) or any(
        token in value.lower() for token in ("/generated/", "/image", "image_", "img_", "agent-assets")
    )


def _looks_like_video_url(url: str) -> bool:
    if not isinstance(url, str):
        return False
    value = url.strip()
    if not value.startswith(("http://", "https://")):
        return False
    return bool(VIDEO_EXT_RE.search(value)) or any(
        token in value.lower() for token in ("/video", "video_", "/videos/", "gen-video", ".mp4")
    )


def _looks_like_audio_url(url: str) -> bool:
    if not isinstance(url, str):
        return False
    value = url.strip()
    if not value.startswith(("http://", "https://")):
        return False
    return bool(AUDIO_EXT_RE.search(value)) or any(
        token in value.lower() for token in ("/audio", "audio_", "/music/", ".mp3", ".wav", ".m4a")
    )


def _extract_image_urls_from_any(payload: Any, *, parent_key: str = "") -> List[str]:
    urls: List[str] = []
    if isinstance(payload, str):
        for match in IMAGE_MARKDOWN_RE.finditer(payload):
            candidate = match.group(1).strip()
            if _looks_like_image_url(candidate):
                urls.append(candidate)
        for candidate in URL_RE.findall(payload):
            c = candidate.strip()
            if _looks_like_image_url(c):
                urls.append(c)
        return urls

    if isinstance(payload, list):
        for item in payload:
            urls.extend(_extract_image_urls_from_any(item, parent_key=parent_key))
        return urls

    if not isinstance(payload, dict):
        return urls

    item_type = str(payload.get("type") or "").strip().lower()
    if item_type == "image_url":
        image_url_obj = payload.get("image_url")
        if isinstance(image_url_obj, dict):
            candidate = str(image_url_obj.get("url") or "").strip()
            if _looks_like_image_url(candidate):
                urls.append(candidate)
        elif isinstance(image_url_obj, str) and _looks_like_image_url(image_url_obj):
            urls.append(image_url_obj.strip())

    for key in ("image_url", "imageUrl", "resourceUrl", "thumbnailUrl", "url", "dataURL"):
        value = payload.get(key)
        if isinstance(value, str):
            key_is_image_like = "image" in key.lower() or "thumbnail" in key.lower() or "resource" in key.lower()
            if (key_is_image_like and value.startswith(("http://", "https://"))) or _looks_like_image_url(value):
                urls.append(value.strip())
        elif isinstance(value, dict):
            urls.extend(_extract_image_urls_from_any(value, parent_key=key))

    for key, value in payload.items():
        if key in {"image_url", "imageUrl", "resourceUrl", "thumbnailUrl", "url", "dataURL"}:
            continue
        if isinstance(value, (dict, list)):
            urls.extend(_extract_image_urls_from_any(value, parent_key=key))
        elif isinstance(value, str):
            key_l = str(key).lower()
            if (
                any(token in key_l for token in ("image", "photo", "avatar", "upload", "attachment"))
                and value.startswith(("http://", "https://"))
            ):
                if _looks_like_image_url(value) or "image" in key_l:
                    urls.append(value.strip())

    return urls


def _extract_media_urls_from_any(payload: Any, *, media_kind: str, parent_key: str = "") -> List[str]:
    matcher = _looks_like_video_url if media_kind == "video" else _looks_like_audio_url
    urls: List[str] = []
    if isinstance(payload, str):
        for candidate in URL_RE.findall(payload):
            c = candidate.strip()
            if matcher(c):
                urls.append(c)
        return urls

    if isinstance(payload, list):
        for item in payload:
            urls.extend(_extract_media_urls_from_any(item, media_kind=media_kind, parent_key=parent_key))
        return urls

    if not isinstance(payload, dict):
        return urls

    key_hints = {"video": ("video", "movie", "clip"), "audio": ("audio", "voice", "music", "sound")}
    item_type = str(payload.get("type") or "").strip().lower()
    if media_kind == "video" and item_type == "video_url":
        video_url_obj = payload.get("video_url")
        if isinstance(video_url_obj, dict):
            candidate = str(video_url_obj.get("url") or "").strip()
            if matcher(candidate):
                urls.append(candidate)
    if media_kind == "audio" and item_type == "audio_url":
        audio_url_obj = payload.get("audio_url")
        if isinstance(audio_url_obj, dict):
            candidate = str(audio_url_obj.get("url") or "").strip()
            if matcher(candidate):
                urls.append(candidate)

    for key in ("video_url", "videoUrl", "audio_url", "audioUrl", "resourceUrl", "url"):
        value = payload.get(key)
        if isinstance(value, str):
            key_l = str(key).lower()
            if any(token in key_l for token in key_hints[media_kind]) and matcher(value):
                urls.append(value.strip())
        elif isinstance(value, dict):
            urls.extend(_extract_media_urls_from_any(value, media_kind=media_kind, parent_key=key))

    for key, value in payload.items():
        if isinstance(value, (dict, list)):
            urls.extend(_extract_media_urls_from_any(value, media_kind=media_kind, parent_key=key))
            continue
        if not isinstance(value, str):
            continue
        key_l = str(key).lower()
        if any(token in key_l for token in key_hints[media_kind]) and matcher(value):
            urls.append(value.strip())

    return urls


def _dedupe_keep_order(values: List[str]) -> List[str]:
    deduped: List[str] = []
    seen: Set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _collect_uploaded_image_urls(messages: List[Dict[str, Any]]) -> List[str]:
    collected: List[str] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        if message.get("role") != "user":
            continue
        collected.extend(_extract_image_urls_from_any(message.get("content")))
        for key in ("attachments", "files", "uploaded_images", "images", "metadata"):
            if key in message:
                collected.extend(_extract_image_urls_from_any(message.get(key), parent_key=key))
    return _dedupe_keep_order(collected)


def _collect_uploaded_video_urls(messages: List[Dict[str, Any]]) -> List[str]:
    collected: List[str] = []
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        collected.extend(_extract_media_urls_from_any(message.get("content"), media_kind="video"))
        for key in ("attachments", "files", "uploaded_videos", "videos", "metadata"):
            if key in message:
                collected.extend(_extract_media_urls_from_any(message.get(key), media_kind="video", parent_key=key))
    return _dedupe_keep_order(collected)


def _collect_uploaded_audio_urls(messages: List[Dict[str, Any]]) -> List[str]:
    collected: List[str] = []
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        collected.extend(_extract_media_urls_from_any(message.get("content"), media_kind="audio"))
        for key in ("attachments", "files", "uploaded_audio", "audios", "audio", "metadata"):
            if key in message:
                collected.extend(_extract_media_urls_from_any(message.get(key), media_kind="audio", parent_key=key))
    return _dedupe_keep_order(collected)


def _iter_canvas_timeline_assets(canvas: Dict[str, Any]) -> List[Dict[str, Any]]:
    canvas_data = canvas.get("data") if isinstance(canvas, dict) and isinstance(canvas.get("data"), dict) else canvas
    timeline = (canvas_data or {}).get("timeline") if isinstance(canvas_data, dict) else None
    tracks = (timeline or {}).get("tracks") if isinstance(timeline, dict) else []
    assets: List[Dict[str, Any]] = []
    for track in tracks if isinstance(tracks, list) else []:
        for asset in (track or {}).get("assets") or []:
            if isinstance(asset, dict):
                assets.append(asset)
    return assets


async def _collect_canvas_timeline_media_urls(canvas_id: str, user_id: str) -> Dict[str, List[str]]:
    if not canvas_id:
        return {"image_urls": [], "video_urls": [], "audio_urls": []}
    try:
        canvas = await api_client_service.get_canvas_data(canvas_id, user_id=user_id)
    except Exception:
        canvas = None
    image_urls: List[str] = []
    video_urls: List[str] = []
    audio_urls: List[str] = []
    for asset in _iter_canvas_timeline_assets(canvas or {}):
        content = asset.get("content") or {}
        metadata = asset.get("metadata") or {}
        storyboard = metadata.get("storyboard") or {}
        for value in (
            content.get("imageUrl"),
            content.get("thumbnailUrl"),
            content.get("posterUrl"),
            metadata.get("thumbnailUrl"),
            metadata.get("primaryImageUrl"),
            metadata.get("inputImageUrl"),
            *list(metadata.get("imageUrls") or []),
            *list(storyboard.get("resolvedReferenceImageUrls") or []),
        ):
            if isinstance(value, str) and value.strip():
                image_urls.append(value.strip())
        for value in (
            content.get("videoUrl"),
            content.get("url"),
            metadata.get("resourceUrl"),
            metadata.get("videoUrl"),
            metadata.get("primaryVideoUrl"),
            metadata.get("providerVideoUrl"),
            storyboard.get("providerVideoUrl"),
            *list(metadata.get("referenceVideoUrls") or []),
            *list(storyboard.get("resolvedReferenceVideoUrls") or []),
        ):
            if isinstance(value, str) and value.strip():
                video_urls.append(value.strip())
        for value in (
            content.get("audioUrl"),
            metadata.get("audioUrl"),
            metadata.get("resourceUrl") if asset.get("type") == "audio" else None,
        ):
            if isinstance(value, str) and value.strip():
                audio_urls.append(value.strip())
    return {
        "image_urls": _dedupe_keep_order(image_urls),
        "video_urls": _dedupe_keep_order(video_urls),
        "audio_urls": _dedupe_keep_order(audio_urls),
    }


def _detect_user_wants_self_insert(messages: List[Dict[str, Any]]) -> bool:
    for message in reversed(messages or []):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        text = _extract_text_content(message.get("content"))
        if text and SELF_INSERT_RE.search(text):
            return True
    return False


def _build_media_runtime_instruction(
    uploaded_image_urls: List[str],
    uploaded_video_urls: List[str],
    uploaded_audio_urls: List[str],
    user_wants_self_insert: bool,
) -> str:
    media_lines = build_numbered_media_lines(
        image_urls=uploaded_image_urls,
        video_urls=uploaded_video_urls,
        audio_urls=uploaded_audio_urls,
        user_wants_self_insert=user_wants_self_insert,
    )
    if not media_lines:
        return ""
    media_lines.append(
        "When handing off between agents, preserve these numbered media references so downstream agents can bind references explicitly instead of guessing."
    )
    return "\n".join(media_lines)


def _extract_latest_user_text(messages: List[Dict[str, Any]]) -> str:
    for message in reversed(messages or []):
        if isinstance(message, dict) and message.get("role") == "user":
            return _extract_text_content(message.get("content")).strip()
    return ""


def _merge_persisted_messages_for_resume(
    persisted_messages: List[Dict[str, Any]],
    request_messages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not persisted_messages:
        return list(request_messages or [])
    merged = list(persisted_messages)
    persisted_signatures = {
        json.dumps(message, ensure_ascii=False, sort_keys=True, default=str)
        for message in merged
        if isinstance(message, dict)
    }
    for message in request_messages or []:
        if not isinstance(message, dict):
            continue
        signature = json.dumps(message, ensure_ascii=False, sort_keys=True, default=str)
        if signature not in persisted_signatures:
            merged.append(message)
            persisted_signatures.add(signature)
    return merged


def _extract_primary_user_text(messages: List[Dict[str, Any]]) -> str:
    """Use the earliest meaningful user message as the language/source anchor."""
    fallback_text = ""
    for message in messages:
        if message.get("role") != "user":
            continue
        content = _extract_text_content(message.get("content")).strip()
        if not content:
            continue
        if not fallback_text:
            fallback_text = content
        return content
    return fallback_text


def _last_user_message_index(messages: List[Dict[str, Any]]) -> int | None:
    for index in range(len(messages or []) - 1, -1, -1):
        message = messages[index]
        if isinstance(message, dict) and message.get("role") == "user":
            return index
    return None


def _tool_call_name_from_message(tool_call: Dict[str, Any]) -> str:
    return str(tool_call.get("name") or (tool_call.get("function") or {}).get("name") or "").strip()


def _tool_call_args_from_message(tool_call: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_args = tool_call.get("args")
    if raw_args is None:
        raw_args = (tool_call.get("function") or {}).get("arguments")

    if raw_args is None:
        return {}
    if isinstance(raw_args, dict):
        return dict(raw_args)
    if isinstance(raw_args, str):
        raw_args = raw_args.strip()
        if not raw_args:
            return {}
        try:
            parsed = json.loads(raw_args)
        except Exception:
            return None
        return dict(parsed) if isinstance(parsed, dict) else None
    return None


def _looks_like_storyboard_payload(payload: Any) -> bool:
    if isinstance(payload, dict):
        text = json.dumps(payload, ensure_ascii=False)
    else:
        text = str(payload or "")
    if "**Structured Output:**" in text or "**Structured Output Cached:**" in text:
        return True
    return ('"shots"' in text) and ('"visual_prompt_en"' in text or '"motion_prompt_en"' in text)


def _extract_storyboard_resume_state(messages: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    latest_state: Optional[Dict[str, Any]] = None
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        metadata = message.get("metadata")
        if not isinstance(metadata, dict):
            continue
        snapshot = metadata.get("storyboard_resume_state")
        if not isinstance(snapshot, dict):
            continue
        if snapshot.get("type") != "storyboard_resume_state":
            continue
        latest_state = dict(snapshot)
    return latest_state


def _extract_recoverable_interrupted_tool_call(messages: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    last_user_idx = _last_user_message_index(messages)
    if last_user_idx is None:
        return None

    last_user_message = messages[last_user_idx] if last_user_idx < len(messages or []) else {}
    if not bool((last_user_message or {}).get("_continuation_intent")):
        return None

    resume_state = _extract_storyboard_resume_state(messages)
    if isinstance(resume_state, dict):
        resume_status = str(resume_state.get("status") or "").strip().lower()
        resume_tool = str(resume_state.get("resumeTool") or "").strip()
        resume_args = resume_state.get("resumeArgs")
        if resume_tool == "execute_storyboard" and resume_status in TERMINAL_RESUME_STATUSES:
            return None
        if resume_tool == "execute_storyboard" and resume_status in RECOVERABLE_RESUME_STATUSES:
            if isinstance(resume_args, dict):
                return {"name": "execute_storyboard", "args": {**resume_args, "resume": True}}
            return {"name": "execute_storyboard", "args": {"resume": True}}

    prior_messages = list(messages[:last_user_idx])
    executed_tool_call_ids: Set[str] = set()
    pending_tool_calls: List[Dict[str, Any]] = []
    has_storyboard_output = False
    has_storyboard_execution_attempt = False

    for index, message in enumerate(prior_messages):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").strip()
        if role == "tool":
            tool_name = str(message.get("name") or "").strip()
            tool_call_id = str(message.get("tool_call_id") or "").strip()
            if tool_call_id:
                executed_tool_call_ids.add(tool_call_id)
            if tool_name == "generate_structured_output" and _looks_like_storyboard_payload(message.get("content")):
                has_storyboard_output = True
            continue
        if role != "assistant":
            continue

        for tool_call in message.get("tool_calls") or []:
            if not isinstance(tool_call, dict):
                continue
            tool_name = _tool_call_name_from_message(tool_call)
            tool_call_id = str(tool_call.get("id") or tool_call.get("tool_call_id") or "").strip()
            if not tool_name or not tool_call_id or tool_name.startswith("transfer_to_"):
                continue
            if tool_name == "execute_storyboard":
                has_storyboard_execution_attempt = True
            tool_args = _tool_call_args_from_message(tool_call)
            if tool_args is None:
                continue
            pending_tool_calls.append(
                {
                    "id": tool_call_id,
                    "name": tool_name,
                    "args": tool_args,
                    "message_index": index,
                }
            )

    unresolved_tool_calls = [
        tool_call
        for tool_call in pending_tool_calls
        if str(tool_call.get("id") or "").strip() and str(tool_call.get("id") or "").strip() not in executed_tool_call_ids
    ]
    if not unresolved_tool_calls:
        return None

    unresolved_names = {str(tool_call.get("name") or "").strip() for tool_call in unresolved_tool_calls}
    if has_storyboard_output and (
        "execute_storyboard" in unresolved_names
        or has_storyboard_execution_attempt
        or bool(unresolved_names & STORYBOARD_CHILD_TOOLS)
    ):
        return {"name": "execute_storyboard", "args": {"resume": True}}

    priority_by_name = {name: rank for rank, name in enumerate(RESUME_TOOL_PRIORITY)}
    unresolved_tool_calls.sort(
        key=lambda tool_call: (
            priority_by_name.get(str(tool_call.get("name") or "").strip(), len(priority_by_name)),
            -int(tool_call.get("message_index") or 0),
        )
    )
    selected = dict(unresolved_tool_calls[0])
    tool_name = str(selected.get("name") or "").strip()
    tool_args = selected.get("args")
    if tool_name == "execute_storyboard" and isinstance(tool_args, dict) and "resume" not in tool_args:
        selected["args"] = {**tool_args, "resume": True}
    return selected


def _has_storyboard_resume_context(messages: List[Dict[str, Any]]) -> bool:
    if _extract_storyboard_resume_state(messages):
        return True
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").strip() == "tool" and _looks_like_storyboard_payload(message.get("content")):
            return True
        if _looks_like_storyboard_payload(message.get("content")):
            return True
    return False


def _forced_storyboard_resume_args(messages: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    resume_state = _extract_storyboard_resume_state(messages)
    if isinstance(resume_state, dict):
        resume_status = str(resume_state.get("status") or "").strip().lower()
        resume_tool = str(resume_state.get("resumeTool") or "").strip()
        if resume_tool == "execute_storyboard" and resume_status in TERMINAL_RESUME_STATUSES:
            return None
        if resume_tool == "execute_storyboard":
            resume_args = resume_state.get("resumeArgs")
            args = dict(resume_args) if isinstance(resume_args, dict) else {}
            args["resume"] = True
            if "storyboard_json" not in args:
                embedded_storyboard = resume_state.get("storyboard")
                if isinstance(embedded_storyboard, dict) and isinstance(embedded_storyboard.get("shots"), list):
                    args["storyboard_json"] = json.dumps(embedded_storyboard, ensure_ascii=False)
            phase = str(resume_state.get("phase") or "").strip()
            if phase in RESUME_FORCEABLE_PHASES and "phase" not in args:
                args["phase"] = "videos" if phase in {"videos", "video"} else "all"
            return args

    if _has_storyboard_resume_context(messages):
        return {"resume": True}
    return None


async def _run_forced_storyboard_resume(
    *,
    ctx: Dict[str, Any],
    args: Dict[str, Any],
    session_id: str,
    canvas_id: str,
    user_id: str,
) -> str:
    tool_call_id = f"forced_execute_storyboard_{uuid.uuid4().hex}"
    args = {**dict(args or {}), "resume": True}
    args_str = json.dumps(args, ensure_ascii=False, indent=2)

    log_runtime_event(
        "resume.storyboard.force_execute",
        session_id=session_id,
        canvas_id=canvas_id,
        user_id=user_id,
        tool_call_id=tool_call_id,
        args=args,
    )
    await send_session_update(
        user_id,
        session_id,
        canvas_id,
        {"type": "tool_call", "id": tool_call_id, "name": "execute_storyboard", "arguments": args_str},
    )
    await send_session_update(
        user_id,
        session_id,
        canvas_id,
        {"type": "tool_call_arguments", "id": tool_call_id, "text": args_str},
    )
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
                    "function": {"name": "execute_storyboard", "arguments": args_str},
                }
            ],
        },
    )

    from tools.storyboard_executor import execute_storyboard

    result = await execute_storyboard.coroutine(
        config=ctx,
        tool_call_id=tool_call_id,
        storyboard_json=args.get("storyboard_json"),
        dry_run=bool(args.get("dry_run", False)),
        phase=args.get("phase", "all"),
        resume=True,
    )
    result_text = str(result or "")
    await send_session_update(
        user_id,
        session_id,
        canvas_id,
        {"type": "tool_result", "tool_call_id": tool_call_id, "content": result_text},
    )
    await create_chat_message(
        session_id=session_id,
        role="tool",
        user_id=user_id,
        content={"role": "tool", "tool_call_id": tool_call_id, "content": result_text, "name": "execute_storyboard"},
    )
    return result_text


def _is_continuation_request_from_messages(messages: List[Dict[str, Any]]) -> bool:
    last_user_idx = _last_user_message_index(messages)
    if last_user_idx is None:
        return False
    last_user_message = messages[last_user_idx] if last_user_idx < len(messages or []) else {}
    return bool((last_user_message or {}).get("_continuation_intent"))


def _detect_preferred_language(text: str) -> str:
    """Lightweight language detection for top-level orchestration."""
    sample = (text or "").strip()
    if not sample:
        return "en"

    if re.search(r"[\uac00-\ud7a3]", sample):
        return "ko-KR"
    if re.search(r"[\u3040-\u30ff]", sample):
        return "ja-JP"

    chinese_count = len(re.findall(r"[\u4e00-\u9fff]", sample))
    latin_count = len(re.findall(r"[A-Za-z]", sample))
    if chinese_count >= 2 and chinese_count >= max(1, latin_count // 2):
        return "zh-CN"

    return "en"


def _build_preferred_language_instruction(preferred_language: str) -> str:
    language_label = {
        "zh-CN": "Simplified Chinese",
        "en": "English",
        "ja-JP": "Japanese",
        "ko-KR": "Korean",
    }.get(preferred_language, preferred_language)
    return (
        f"Preferred language for planning, screenplay text, summaries, titles, world descriptions, "
        f"script segment text, and all other user-facing fields is {language_label} ({preferred_language}). "
        "This preference applies across the whole agent chain, including planner decisions, handoff context, "
        "script writing, image/video editing instructions, and other intermediate user-visible creative steps. "
        "Fields ending in `_en` must stay in English because they are model prompts. "
        "If the user provides an existing story/IP/title/character/place/term, preserve it exactly; "
        "do not rename, translate, westernize, or replace it unless the user explicitly asks."
    )


def _prepend_runtime_system_message(
    messages: List[Dict[str, Any]],
    preferred_language_instruction: str,
    media_runtime_instruction: str = "",
    context_runtime_instruction: str = "",
    skill_runtime_instruction: str = "",
) -> List[Dict[str, Any]]:
    runtime_parts = [
        "Runtime orchestration rule. " + preferred_language_instruction,
    ]
    if media_runtime_instruction:
        runtime_parts.append(media_runtime_instruction)
    if context_runtime_instruction:
        runtime_parts.append(context_runtime_instruction)
    if skill_runtime_instruction:
        runtime_parts.append(skill_runtime_instruction)
    runtime_system_message = {
        "role": "system",
        "content": "\n\n".join(part for part in runtime_parts if part),
    }
    return [runtime_system_message, *messages]


AUTO_SKILL_RULES = [
    {
        "skill": "cinematic-story-architecture",
        "keywords": (
            "story", "剧情", "剧本", "脚本", "screenplay", "episode", "短剧", "叙事",
            "adaptation", "改编", "trailer", "plot", "beat", "scene"
        ),
    },
    {
        "skill": "director-visual-language",
        "keywords": (
            "cinematic", "电影", "导演", "镜头语言", "aesthetic", "lighting", "lens",
            "构图", "美学", "commercial", "广告", "film", "trailer", "氛围",
            "2.35:1", "2.39:1", "85mm", "t1.8", "arri", "master primes", "光圈", "焦距"
        ),
    },
    {
        "skill": "cinema-studio-lens-look",
        "keywords": (
            "cinema studio", "cinema-studio", "2.35:1", "2.39:1", "85mm", "t1.8",
            "arri", "master primes", "anamorphic", "bokeh", "光圈", "焦距", "电影感", "胶片颗粒", "光晕"
        ),
    },
    {
        "skill": "storyboard-shot-design",
        "keywords": (
            "storyboard", "分镜", "shot", "shotlist", "camera", "镜头", "运镜",
            "coverage", "montage", "blocking", "拍摄"
        ),
    },
    {
        "skill": "long-form-continuity-bible",
        "keywords": (
            "continue", "continuity", "一致性", "连续", "续写", "world", "character consistency",
            "series", "multi-shot", "长", "保持", "同一个角色", "同一场景"
        ),
    },
    {
        "skill": "dialogue-performance-blocking",
        "keywords": (
            "dialogue", "对白", "表演", "performance", "emotion", "情绪", "actor", "角色表演",
            "micro-expression", "口型", "lip sync", "对话戏"
        ),
    },
    {
        "skill": "screenplay-fountain-format",
        "keywords": (
            "screenplay", "fountain", "script format", "台词", "dialogue format", "scene heading",
            "剧本格式", "脚本格式"
        ),
    },
    {
        "skill": "shot-size-and-angle-language",
        "keywords": (
            "close-up", "wide shot", "low angle", "high angle", "framing", "shot size",
            "特写", "远景", "低角度", "高角度", "景别"
        ),
    },
    {
        "skill": "scene-blocking-and-staging",
        "keywords": (
            "blocking", "staging", "调度", "走位", "movement", "ensemble", "空间关系"
        ),
    },
    {
        "skill": "lighting-continuity-design",
        "keywords": (
            "lighting", "light", "contrast", "shadow", "backlight", "rim light",
            "光线", "打光", "阴影", "对比度"
        ),
    },
    {
        "skill": "continuity-editing-axis-match",
        "keywords": (
            "180 degree", "axis", "match on action", "screen direction", "continuity edit",
            "轴线", "180度", "匹配动作", "连续剪辑"
        ),
    },
    {
        "skill": "reference-driven-video-prompting",
        "keywords": (
            "reference", "input image", "image-to-video", "keyframe", "reference video",
            "参考图", "垫图", "首尾帧", "图生视频", "参考视频", "@video", "@image", "@视频", "@图"
        ),
    },
    {
        "skill": "sd2-pe",
        "keywords": (
            "seedance", "seedance 2.0", "sd2", "video-to-video", "image-to-video",
            "v2v", "i2v", "@video", "@image", "@视频", "@图", "extend", "无缝", "续写"
        ),
    },
    {
        "skill": "short-drama-hook-engineering",
        "keywords": (
            "short drama", "retention", "hook", "cold open", "前三秒", "开场钩子", "短剧", "留存", "爽点"
        ),
    },
    {
        "skill": "action-choreography-camera-logic",
        "keywords": (
            "fight", "combat", "battle", "action", "chase", "transformation", "打斗", "战斗", "追逐", "变身", "动作戏"
        ),
    },
    {
        "skill": "cinematic-hit-marking-action-director",
        "keywords": (
            "hit mark", "hit-marking", "impact frame", "screen shake", "particle",
            "fight", "combat", "battle", "action", "chase", "打点", "顿帧", "震屏", "粒子", "打斗", "战斗", "动作戏"
        ),
    },
    {
        "skill": "world-asset-identity-lock",
        "keywords": (
            "identity", "same character", "consistency", "world asset", "角色一致", "造型一致", "世界观一致", "同一个角色"
        ),
    },
    {
        "skill": "commercial-ad-psychology",
        "keywords": (
            "commercial", "advertisement", "brand", "product film", "广告", "品牌", "产品片", "转化"
        ),
    },
    {
        "skill": "environment-scene-extraction-bible",
        "keywords": (
            "environment only", "scene extraction", "location design", "no humans", "场景提取", "环境设计", "无人场景", "纯场景"
        ),
    },
]

STAGE_SKILL_GROUPS = {
    "planner": [
        "cinematic-story-architecture",
        "director-visual-language",
    ],
    "script": [
        "screenplay-fountain-format",
        "storyboard-shot-design",
        "dialogue-performance-blocking",
        "short-drama-hook-engineering",
        "commercial-ad-psychology",
    ],
    "continuity": [
        "long-form-continuity-bible",
        "continuity-editing-axis-match",
        "world-asset-identity-lock",
    ],
    "reference_video": [
        "sd2-pe",
        "reference-driven-video-prompting",
        "shot-size-and-angle-language",
        "lighting-continuity-design",
        "scene-blocking-and-staging",
        "action-choreography-camera-logic",
        "cinematic-hit-marking-action-director",
        "cinema-studio-lens-look",
        "world-asset-identity-lock",
        "environment-scene-extraction-bible",
    ],
}


AGENT_STAGE_SKILL_GROUPS = {
    "planner": ["planner"],
    "script_writer": ["planner", "script", "continuity"],
    "image_designer": ["planner", "reference_video"],
    "image_edit_agent": ["planner", "reference_video", "continuity"],
    "video_designer": ["planner", "reference_video", "continuity"],
    "flf_video_designer": ["planner", "reference_video", "continuity"],
    "structured_output_agent": ["planner", "script"],
    "function_calling_agent": ["planner"],
    "web_context_agent": ["planner"],
    "search_agent": ["planner"],
}


def _skill_payload(manifest: Any) -> dict[str, Any]:
    return {
        "name": manifest.name,
        "description": manifest.description,
        "instructions": manifest.instructions[:5000].strip(),
    }


def _available_skills_for_agent(agent_name: str) -> dict[str, Any]:
    return {
        skill.name.strip().lower(): skill
        for skill in filter_skills_for_agent(load_skill_catalog(), agent_name)
    }


def _request_stage_names(primary_user_text: str, is_continuation: bool = False) -> list[str]:
    text = str(primary_user_text or "").strip().lower()
    requested_story_mode = any(
        token in text for token in ("story", "剧情", "剧本", "脚本", "screenplay", "storyboard", "分镜", "trailer", "短剧")
    )
    requested_reference_mode = any(
        token in text for token in ("reference", "input image", "image-to-video", "图生视频", "首尾帧", "参考图", "参考视频")
    )
    requested_dialogue_mode = any(
        token in text for token in ("dialogue", "对白", "表演", "emotion", "口型", "lip sync", "actor")
    )
    requested_action_mode = any(
        token in text for token in ("fight", "combat", "battle", "action", "chase", "打斗", "战斗", "追逐", "动作戏")
    )
    requested_hook_mode = any(
        token in text for token in ("hook", "cold open", "opening", "前三秒", "开场", "留存", "爆点", "爽点")
    )
    requested_identity_mode = any(
        token in text
        for token in ("identity", "consistency", "same character", "角色一致", "造型一致", "世界观一致", "同一个角色")
    )

    stage_names = ["planner"]
    if requested_story_mode:
        stage_names.append("script")
    if requested_reference_mode or requested_action_mode:
        stage_names.append("reference_video")
    if requested_dialogue_mode:
        stage_names.append("script")
    if requested_hook_mode:
        stage_names.append("script")
    if is_continuation or requested_identity_mode:
        stage_names.append("continuity")
        stage_names.append("reference_video")

    deduped: list[str] = []
    seen: set[str] = set()
    for stage_name in stage_names:
        if stage_name in seen:
            continue
        seen.add(stage_name)
        deduped.append(stage_name)
    return deduped


def _extend_skills_with_stage_names(
    selected: list[dict[str, Any]],
    available: dict[str, Any],
    stage_names: list[str],
) -> list[dict[str, Any]]:
    enriched = list(selected)
    seen = {str(skill.get("name") or "").strip().lower() for skill in enriched}
    for stage_name in stage_names:
        for skill_name in STAGE_SKILL_GROUPS.get(stage_name, []):
            normalized = skill_name.strip().lower()
            if normalized in seen or normalized not in available:
                continue
            enriched.append(_skill_payload(available[normalized]))
            seen.add(normalized)
    return enriched


def _select_auto_skills(primary_user_text: str, is_continuation: bool = False) -> list[dict[str, Any]]:
    text = str(primary_user_text or "").strip().lower()
    available = _available_skills_for_agent("planner")
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for rule in AUTO_SKILL_RULES:
        skill_name = str(rule["skill"]).strip().lower()
        if skill_name not in available or skill_name in seen:
            continue
        if any(keyword.lower() in text for keyword in rule["keywords"]):
            selected.append(_skill_payload(available[skill_name]))
            seen.add(skill_name)

    if is_continuation and "long-form-continuity-bible" in available and "long-form-continuity-bible" not in seen:
        selected.append(_skill_payload(available["long-form-continuity-bible"]))

    return selected[:4]


def _extend_with_stage_skills(auto_skills: list[dict[str, Any]], primary_user_text: str, is_continuation: bool = False) -> list[dict[str, Any]]:
    available = _available_skills_for_agent("planner")
    stage_names = _request_stage_names(primary_user_text=primary_user_text, is_continuation=is_continuation)
    selected = _extend_skills_with_stage_names(auto_skills, available, stage_names)
    text = str(primary_user_text or "").strip().lower()
    seen = {str(skill.get("name") or "").strip().lower() for skill in selected}

    def _maybe_add(skill_name: str) -> None:
        normalized = skill_name.strip().lower()
        if normalized in seen or normalized not in available:
            return
        selected.append(_skill_payload(available[normalized]))
        seen.add(normalized)

    if is_continuation or "reference_video" in stage_names or len(text) > 600:
        _maybe_add("sd2-pe")
    if any(token in text for token in ("fight", "combat", "battle", "action", "chase", "打斗", "战斗", "动作戏", "追逐")):
        _maybe_add("cinematic-hit-marking-action-director")
    if any(token in text for token in ("cinematic", "电影", "2.35:1", "2.39:1", "85mm", "t1.8", "arri", "master primes", "电影感", "光圈")):
        _maybe_add("cinema-studio-lens-look")
    return selected[:8]


def _render_skill_runtime_instruction(auto_skills: list[dict[str, Any]]) -> str:
    if not auto_skills:
        return ""
    rendered = []
    for skill in auto_skills:
        instructions = str(skill.get("instructions") or "").strip()
        if not instructions:
            continue
        rendered.append(
            f"[Auto-Activated Skill: {skill.get('name')}]\n"
            f"Purpose: {skill.get('description') or ''}\n"
            f"{instructions}"
        )
    if not rendered:
        return ""
    return (
        "Auto-activated NolanX skills for this request. Treat these as active operating constraints and preferred workflow patterns "
        "for planning, screenplay design, storyboard structure, continuity management, and downstream handoffs:\n\n"
        + "\n\n".join(rendered)
    )


def _build_agent_auto_skill_map(
    auto_skills: list[dict[str, Any]],
    *,
    primary_user_text: str,
    is_continuation: bool,
) -> dict[str, list[dict[str, Any]]]:
    request_stage_names = _request_stage_names(
        primary_user_text=primary_user_text,
        is_continuation=is_continuation,
    )
    agent_skill_map: dict[str, list[dict[str, Any]]] = {}
    for agent_name, default_stage_names in AGENT_STAGE_SKILL_GROUPS.items():
        available = _available_skills_for_agent(agent_name)
        base_skills = [
            skill
            for skill in auto_skills
            if str(skill.get("name") or "").strip().lower() in available
        ]
        stage_names = [name for name in default_stage_names if name in request_stage_names or name == "planner"]
        if is_continuation and "continuity" in default_stage_names and "continuity" not in stage_names:
            stage_names.append("continuity")
        if "reference_video" in default_stage_names and "reference_video" in request_stage_names and "reference_video" not in stage_names:
            stage_names.append("reference_video")
        agent_skill_map[agent_name] = _extend_skills_with_stage_names(base_skills, available, stage_names)[:6]
    return agent_skill_map


def _fix_chat_history(messages):
    """修复聊天历史中不完整的工具调用和Gemini API兼容性问题

    主要修复：
    1. 移除没有对应ToolMessage的tool_calls (LangGraph要求)
    2. 修复空的name字段 (Gemini API要求function_response.name不能为空)
    3. 确保工具调用和响应的完整性

    参考: https://langchain-ai.github.io/langgraph/troubleshooting/errors/INVALID_CHAT_HISTORY/
    """
    if not messages:
        return messages

    messages = [
        {key: value for key, value in dict(msg).items() if key != "_continuation_intent"}
        if isinstance(msg, dict)
        else msg
        for msg in messages
    ]

    log_runtime_event("chat_history.repair.started", message_count=len(messages))

    fixed_messages: List[Dict[str, Any]] = []
    tool_call_ids: Set[str] = set()
    tool_call_to_name: Dict[str, str] = {}  # 映射tool_call_id到工具名称

    # 第一遍：收集所有ToolMessage的tool_call_id，并修复空的name字段
    tool_messages_fixed = 0
    for i, msg in enumerate(messages):
        log_runtime_event(
            "chat_history.message.inspect",
            index=i,
            role=msg.get('role'),
            tool_call_id=msg.get('tool_call_id'),
            name=msg.get('name'),
        )

        if msg.get('role') == 'tool' and msg.get('tool_call_id') and msg.get('tool_call_id').strip():
            tool_call_id = msg.get('tool_call_id')
            if tool_call_id and tool_call_id.strip():
                tool_call_ids.add(tool_call_id)

                # 修复空的name字段 - 这是Gemini API的关键要求
                if not msg.get('name'):
                    # 尝试从对应的tool_call中获取函数名
                    tool_name = tool_call_to_name.get(tool_call_id, 'unknown_tool')
                    msg['name'] = tool_name
                    tool_messages_fixed += 1
                    log_runtime_event(
                        "chat_history.tool_name.repaired",
                        tool_call_id=tool_call_id,
                        name=tool_name,
                    )
                else:
                    # 记录已有的name映射
                    tool_call_to_name[tool_call_id] = msg['name']
                    log_runtime_event(
                        "chat_history.tool_name.present",
                        tool_call_id=tool_call_id,
                        name=msg['name'],
                    )
        elif msg.get('role') == 'tool':
            log_runtime_warning("chat_history.tool_message.missing_tool_call_id", message=msg)
        elif msg.get('role') == 'assistant' and msg.get('tool_calls'):
            log_runtime_event(
                "chat_history.assistant_tool_calls.detected",
                tool_call_count=len(msg.get('tool_calls', [])),
            )

    # 第一遍补充：从assistant消息中收集tool_call信息
    for msg in messages:
        if msg.get('role') == 'assistant' and msg.get('tool_calls'):
            for tool_call in msg.get('tool_calls', []):
                tool_call_id = tool_call.get('id')
                function_name = tool_call.get('function', {}).get('name')
                if tool_call_id and function_name:
                    tool_call_to_name[tool_call_id] = function_name

    # 重新修复那些之前无法确定名称的tool消息
    for msg in messages:
        if (msg.get('role') == 'tool' and
            msg.get('tool_call_id') and
            msg.get('name') == 'unknown_tool'):
            tool_call_id = msg.get('tool_call_id')
            if tool_call_id in tool_call_to_name:
                msg['name'] = tool_call_to_name[tool_call_id]
                log_runtime_event(
                    "chat_history.tool_name.updated",
                    tool_call_id=tool_call_id,
                    name=msg['name'],
                )

    if tool_messages_fixed > 0:
        log_runtime_event("chat_history.tool_names.repaired", repaired_count=tool_messages_fixed)

    # 第二遍：修复AIMessage中的tool_calls
    auto_generated_tool_messages = 0
    for msg in messages:
        if msg.get('role') == 'assistant' and msg.get('tool_calls'):
            # 过滤掉没有对应ToolMessage的tool_calls
            valid_tool_calls: List[Dict[str, Any]] = []
            removed_calls: List[str] = []

            for tool_call in msg.get('tool_calls', []):
                tool_call_id = tool_call.get('id')
                if tool_call_id in tool_call_ids:
                    valid_tool_calls.append(tool_call)
                elif tool_call_id:
                    removed_calls.append(tool_call_id)

            # 记录修复信息
            if removed_calls:
                log_runtime_warning(
                    "chat_history.tool_calls.removed",
                    removed_count=len(removed_calls),
                    removed_tool_call_ids=removed_calls,
                )

            # 更新消息
            if valid_tool_calls:
                msg_copy = msg.copy()
                msg_copy['tool_calls'] = valid_tool_calls
                fixed_messages.append(msg_copy)
                # 对于缺失 ToolMessage 的tool_call，自动补全
                for tool_call in valid_tool_calls:
                    tool_call_id = tool_call.get('id')
                    if tool_call_id and tool_call_id not in tool_call_ids:
                        tool_name = tool_call.get('function', {}).get('name', 'tool_response')
                        placeholder_content = (
                            "<hide_in_user_ui>[system] Missing tool response was auto-generated to satisfy tool call requirements.</hide_in_user_ui>"
                        )
                        auto_tool_message = {
                            'role': 'tool',
                            'tool_call_id': tool_call_id,
                            'name': tool_name,
                            'content': placeholder_content
                        }
                        fixed_messages.append(auto_tool_message)
                        tool_call_ids.add(tool_call_id)
                        tool_call_to_name[tool_call_id] = tool_name
                        auto_generated_tool_messages += 1
                        log_runtime_warning(
                            "chat_history.tool_message.auto_generated",
                            tool_call_id=tool_call_id,
                            name=tool_name,
                        )
            elif msg.get('content'):  # 如果没有有效的tool_calls但有content，保留消息
                msg_copy = msg.copy()
                msg_copy.pop('tool_calls', None)  # 移除空的tool_calls
                fixed_messages.append(msg_copy)
            # 如果既没有有效tool_calls也没有content，跳过这条消息
        else:
            # 非assistant消息或没有tool_calls的消息直接保留
            # 但是要特别处理tool消息的name字段
            if msg.get('role') == 'tool':
                msg_copy = msg.copy()
                if not msg_copy.get('name'):
                    # 最后的兜底处理
                    tool_call_id = msg_copy.get('tool_call_id')
                    tool_name = tool_call_to_name.get(tool_call_id, 'unknown_tool')
                    msg_copy['name'] = tool_name
                    log_runtime_event(
                        "chat_history.tool_name.backfilled",
                        tool_call_id=tool_call_id,
                        name=tool_name,
                    )
                fixed_messages.append(msg_copy)
            else:
                fixed_messages.append(msg)

    log_runtime_event(
        "chat_history.repair.completed",
        original_message_count=len(messages),
        repaired_message_count=len(fixed_messages),
        auto_generated_tool_messages=auto_generated_tool_messages,
    )
    return fixed_messages

def get_last_active_agent(messages, agent_names):
    """
    Determine the last active agent from message history.
    For continuation commands, always return None to start with planner.

    Args:
        messages: List of conversation messages
        agent_names: List of available agent names

    Returns:
        Name of the last active agent or None
    """
    # Check if the last user message is a continuation command
    # Find the last user message
    for message in messages[::-1]:
        if message.get('role') == 'user':
            # If it's a continuation command, always start with planner
            if bool(message.get("_continuation_intent")):
                content = _extract_text_content(message.get('content')).strip().lower()
                log_runtime_event("routing.continuation_command", command=content, target_agent="planner")
                return None  # This will cause system to start with planner
            break

    # For non-continuation commands, find the last active agent
    for message in messages[::-1]:
        if message.get('role') == 'assistant':
            if message.get('name') in agent_names:
                return message.get('name')
    return None

def create_agents(model):
    """
    Create all agents with the given model.

    Args:
        model: The LLM model instance

    Returns:
        List of configured agents
    """
    agents = [
        create_planner_agent(model),
        create_script_writer_agent(model),
        create_image_designer_agent(model),
        create_image_edit_agent(model),
        create_audio_designer_agent(model),
        create_video_designer_agent(model),
        create_flf_video_designer_agent(model),
        # create_gemini_veo_designer_agent(model),
        create_tts_designer_agent(model),
        create_music_designer_agent(model),
        create_code_execution_agent(model),
        create_document_analyzer_agent(model),
        create_structured_output_agent(model),
        create_media_analyzer_agent(model),
        create_function_calling_agent(model),
        create_web_context_agent(model),
        create_search_agent(model)
    ]

    log_runtime_event(
        "agents.created",
        agent_count=len(agents),
        agent_names=[getattr(agent, "name", None) for agent in agents],
    )
    return agents


async def nolanx_multi_agent(messages, canvas_id, session_id, user_id, preferred_language=None):
    """
    Main entry point for multi-agent processing.

    Args:
        messages: List of conversation messages
        canvas_id: Canvas identifier
        session_id: Session identifier
        user_id: User identifier
    """
    try:
        log_runtime_event(
            "chat.pipeline.started",
            canvas_id=canvas_id,
            session_id=session_id,
            user_id=user_id,
            message_count=len(messages or []),
        )
        runtime_components = get_runtime_components()

        # Create LLM model
        model = create_llm_model()
        
        raw_messages = list(messages or [])
        latest_user_text = _extract_latest_user_text(raw_messages)
        is_continuation = await classify_continuation_intent_with_llm(
            model=model,
            text=latest_user_text,
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
        )
        log_runtime_event(
            "chat.continuation_intent.resolved",
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
            is_continuation=is_continuation,
            latest_user_text=latest_user_text[:160],
        )
        resume_detection_messages = [
            dict(message) if isinstance(message, dict) else message
            for message in raw_messages
        ]
        if is_continuation:
            persisted_messages = await fetch_session_messages(session_id=session_id)
            if persisted_messages:
                resume_detection_messages = _merge_persisted_messages_for_resume(
                    persisted_messages,
                    resume_detection_messages,
                )
                log_runtime_event(
                    "resume.persisted_messages.loaded",
                    session_id=session_id,
                    canvas_id=canvas_id,
                    user_id=user_id,
                    persisted_message_count=len(persisted_messages),
                    merged_message_count=len(resume_detection_messages),
                )
        if is_continuation:
            for message in reversed(resume_detection_messages):
                if isinstance(message, dict) and message.get("role") == "user":
                    message["_continuation_intent"] = True
                    break
        interrupted_tool_call = _extract_recoverable_interrupted_tool_call(resume_detection_messages or [])
        fixedMsgs = _fix_chat_history(raw_messages)
        uploaded_image_urls = _collect_uploaded_image_urls(fixedMsgs)
        uploaded_video_urls = _collect_uploaded_video_urls(fixedMsgs)
        uploaded_audio_urls = _collect_uploaded_audio_urls(fixedMsgs)
        if is_continuation:
            timeline_media = await _collect_canvas_timeline_media_urls(canvas_id=canvas_id, user_id=user_id)
            uploaded_image_urls = _dedupe_keep_order(uploaded_image_urls + timeline_media.get("image_urls", []))
            uploaded_video_urls = _dedupe_keep_order(uploaded_video_urls + timeline_media.get("video_urls", []))
            uploaded_audio_urls = _dedupe_keep_order(uploaded_audio_urls + timeline_media.get("audio_urls", []))
        user_wants_self_insert = _detect_user_wants_self_insert(fixedMsgs)
        primary_user_text = _extract_primary_user_text(fixedMsgs)
        preferred_language = str(preferred_language or "").strip() or _detect_preferred_language(primary_user_text)
        preferred_language_instruction = _build_preferred_language_instruction(preferred_language)
        media_runtime_instruction = _build_media_runtime_instruction(
            uploaded_image_urls,
            uploaded_video_urls,
            uploaded_audio_urls,
            user_wants_self_insert,
        )
        context_file_snapshot = get_context_file_snapshot()
        memory_snapshot = get_memory_snapshot(user_id=user_id, session_id=session_id, canvas_id=canvas_id)
        context_runtime_instruction = "\n\n".join(
            part
            for part in [
                render_context_file_instruction(context_file_snapshot),
                render_memory_instruction(memory_snapshot),
            ]
            if part
        ).strip()
        log_runtime_event(
            "language.detected",
            preferred_language=preferred_language,
            anchor_text=(primary_user_text[:120] + "...") if primary_user_text and len(primary_user_text) > 120 else primary_user_text,
        )
        log_runtime_event(
            "media_context.detected",
            uploaded_image_count=len(uploaded_image_urls),
            uploaded_video_count=len(uploaded_video_urls),
            uploaded_audio_count=len(uploaded_audio_urls),
            user_wants_self_insert=user_wants_self_insert,
            uploaded_image_urls=uploaded_image_urls[:8],
            uploaded_video_urls=uploaded_video_urls[:8],
            uploaded_audio_urls=uploaded_audio_urls[:8],
        )
        if context_file_snapshot.get("identity_file") or context_file_snapshot.get("project_files"):
            log_runtime_event(
                "context_files.detected",
                identity_file=context_file_snapshot.get("identity_file"),
                project_file_count=len(context_file_snapshot.get("project_files") or []),
                workspace_root=context_file_snapshot.get("workspace_root"),
            )
        if memory_snapshot.get("memory") or memory_snapshot.get("user"):
            log_runtime_event(
                "memory.snapshot.detected",
                user_id=user_id,
                memory_chars=len(str(memory_snapshot.get("memory") or "")),
                user_chars=len(str(memory_snapshot.get("user") or "")),
                files=memory_snapshot.get("files"),
            )
        log_runtime_event(
            "runtime.profile",
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
            profile=runtime_components.get("config") or {},
            capabilities=get_capability_snapshot(agent_name="planner"),
        )
        if interrupted_tool_call:
            log_runtime_event(
                "resume.interrupted_tool_detected",
                session_id=session_id,
                canvas_id=canvas_id,
                user_id=user_id,
                tool_name=interrupted_tool_call.get("name"),
                tool_args=interrupted_tool_call.get("args"),
            )
        elif is_continuation:
            log_runtime_warning(
                "resume.continuation_without_interrupted_tool",
                session_id=session_id,
                canvas_id=canvas_id,
                user_id=user_id,
                has_storyboard_context=_has_storyboard_resume_context(resume_detection_messages),
            )
        auto_skills = _select_auto_skills(
            primary_user_text=primary_user_text,
            is_continuation=is_continuation,
        )
        auto_skills = _extend_with_stage_skills(
            auto_skills,
            primary_user_text=primary_user_text,
            is_continuation=is_continuation,
        )
        agent_auto_skill_map = _build_agent_auto_skill_map(
            auto_skills,
            primary_user_text=primary_user_text,
            is_continuation=is_continuation,
        )
        skill_runtime_instruction = _render_skill_runtime_instruction(auto_skills)
        if auto_skills:
            log_runtime_event(
                "skills.auto_activated",
                session_id=session_id,
                canvas_id=canvas_id,
                user_id=user_id,
                skills=[skill.get("name") for skill in auto_skills],
                agent_skill_targets={
                    agent_name: [skill.get("name") for skill in skills]
                    for agent_name, skills in agent_auto_skill_map.items()
                    if skills
                },
            )
        fixedMsgs = _prepend_runtime_system_message(
            fixedMsgs,
            preferred_language_instruction,
            media_runtime_instruction=media_runtime_instruction,
            context_runtime_instruction=context_runtime_instruction,
            skill_runtime_instruction=skill_runtime_instruction,
        )

        # Create context configuration
        ctx = create_context_config(
            canvas_id,
            session_id,
            user_id,
            preferred_language=preferred_language,
            preferred_language_instruction=preferred_language_instruction,
            messages=fixedMsgs,
            uploaded_image_urls=uploaded_image_urls,
            uploaded_video_urls=uploaded_video_urls,
            uploaded_audio_urls=uploaded_audio_urls,
            user_wants_self_insert=user_wants_self_insert,
            continuation_intent=is_continuation,
            interrupted_tool_call=interrupted_tool_call,
            auto_skills=auto_skills,
            agent_auto_skill_map=agent_auto_skill_map,
        )
        await refresh_context_memory(
            user_id=user_id,
            session_id=session_id,
            canvas_id=canvas_id,
            ctx=ctx,
        )

        forced_resume_args = _forced_storyboard_resume_args(resume_detection_messages) if is_continuation else None
        log_runtime_event(
            "resume.storyboard.route_decision",
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
            is_continuation=is_continuation,
            has_forced_resume_args=forced_resume_args is not None,
            forced_resume_args=forced_resume_args,
            has_storyboard_context=_has_storyboard_resume_context(resume_detection_messages),
        )
        if forced_resume_args is not None:
            await _run_forced_storyboard_resume(
                ctx=ctx,
                args=forced_resume_args,
                session_id=session_id,
                canvas_id=canvas_id,
                user_id=user_id,
            )
            log_runtime_event(
                "chat.pipeline.completed",
                canvas_id=canvas_id,
                session_id=session_id,
                user_id=user_id,
                forced_resume=True,
            )
            await send_session_update(user_id, session_id, canvas_id, {"type": "done"})
            return

        # Create all agents
        agents = create_agents(model)
        agent_names = [
            'planner', 'script_writer', 'image_designer', 'image_edit_agent', 'audio_designer', 'video_designer', 'flf_video_designer',
            # 'gemini_veo_designer',
            'tts_designer', 'music_designer', 'code_execution_agent',
            'document_analyzer_agent', 'structured_output_agent', 'media_analyzer_agent',
            'function_calling_agent', 'web_context_agent', 'search_agent'
        ]

        # Create swarm with default active agent
        log_runtime_event(
            "swarm.compiling",
            agent_count=len(agents),
            default_active_agent="planner",
        )

        swarm = create_swarm(
            agents=agents,
            default_active_agent="planner"  # Always start with planner for consistency
        ).compile(
            checkpointer=runtime_components["checkpointer"],
            store=runtime_components["store"],
            name="nolanx_swarm",
        )

        # 最终修复：确保所有 ToolMessage 都有 name 字段，特别处理空的 tool_call_id
        for msg in fixedMsgs:
            if msg.get('role') == 'tool':
                # 如果 tool_call_id 是空字符串，移除这个消息或修复它
                tool_call_id = msg.get('tool_call_id', '')
                if not tool_call_id or not tool_call_id.strip():
                    log_runtime_warning("chat_history.empty_tool_call_id.removed", message=msg)
                    continue  # 跳过这个消息，实际上我们需要从列表中移除它

                if not msg.get('name'):
                    msg['name'] = 'tool_response'
                    log_runtime_event(
                        "chat_history.tool_name.finalized",
                        tool_call_id=tool_call_id,
                        name=msg['name'],
                    )

        # 移除有空 tool_call_id 的 tool 消息
        fixedMsgs = [msg for msg in fixedMsgs if not (
            msg.get('role') == 'tool' and
            (not msg.get('tool_call_id') or not msg.get('tool_call_id').strip())
        )]
        log_runtime_event("chat_history.filtered", remaining_message_count=len(fixedMsgs))

        # Handle streaming response
        stream_ok = await handle_streaming_response(swarm, fixedMsgs, ctx, session_id, user_id, canvas_id)
        if stream_ok:
            log_runtime_event("chat.pipeline.completed", canvas_id=canvas_id, session_id=session_id, user_id=user_id)
        else:
            log_runtime_warning("chat.pipeline.aborted", canvas_id=canvas_id, session_id=session_id, user_id=user_id)

        # Send completion event
        if stream_ok:
            await send_session_update(user_id, session_id, canvas_id, {
                'type': 'done'
            })

    except Exception as e:
        log_runtime_exception(
            "chat.pipeline.failed",
            e,
            canvas_id=canvas_id,
            session_id=session_id,
            user_id=user_id,
        )
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': str(e)
        })


langgraph_multi_agent = nolanx_multi_agent
