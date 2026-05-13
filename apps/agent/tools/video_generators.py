import random
import json
import time
import traceback
import uuid
import re
from typing import Optional, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.nolanx.bridges import invoke_acp_bridge
from services.runtime_logger import log_runtime_event, log_runtime_warning
from services.websocket_service import send_session_update

# Import all generators
from .vid_generators import (
    # FalAIVideoGenerator,
    ReelMindVideoGenerator,
    GeminiVeoVideoGenerator,
)
from .aspect_ratio_utils import normalize_generation_aspect_ratio

CANONICAL_VIDEO_DURATION_SECONDS = 15
WORLD_REFERENCE_VIDEO_LIMIT = 3
BYTEPLUS_VIDEO_FPS = 24


def _nolanx_phase_runtime_config() -> dict:
    cfg = config_service.get_service_config("nolanx") or {}
    return cfg.get("phase_runtimes") or {}


async def _try_delegate_video_to_acp(
    *,
    prompt: str,
    config: RunnableConfig,
    aspect_ratio: str,
    duration: float | int,
    input_image: Optional[str],
    input_images: Optional[list[str]],
    input_videos: Optional[list[str]],
    frames: Optional[int],
) -> Optional[str]:
    phase_cfg = (_nolanx_phase_runtime_config().get("video_designer") or {})
    if not phase_cfg.get("enabled"):
        return None

    bridge_name = str(phase_cfg.get("bridge_name") or "").strip()
    operation = str(phase_cfg.get("operation") or "generate_video").strip()
    if not bridge_name:
        return None

    configurable = config.get("configurable", {}) or {}
    result = await invoke_acp_bridge(
        bridge_name=bridge_name,
        operation=operation,
        payload={
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "frames": frames,
            "input_image": input_image,
            "input_images": input_images or [],
            "input_videos": input_videos or [],
            "preferred_language": configurable.get("preferred_language"),
            "auto_skills": configurable.get("auto_skills") or [],
            "agent_auto_skills": (configurable.get("agent_auto_skill_map") or {}).get("video_designer") or [],
        },
        session_id=configurable.get("session_id"),
        canvas_id=configurable.get("canvas_id"),
        user_id=configurable.get("user_id"),
    )

    remote = result.get("result") if isinstance(result, dict) else None
    if isinstance(remote, dict):
        content = remote.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return None

# 生成唯一文件 ID (现在使用UUID格式)
def generate_file_id():
    return str(uuid.uuid4())


class GenerateVideoInputSchema(BaseModel):
    prompt: str = Field(description="Text prompt describing the video content and motion")
    input_image: Optional[str] = Field(
        default=None,
        description="Primary image url or file id to use as the starting frame for video generation."
    )
    input_images: Optional[list[str]] = Field(
        default=None,
        description="Optional additional reference images (URLs or file ids) for Kling O3 reference-to-video."
    )
    input_videos: Optional[list[str]] = Field(
        default=None,
        description="Optional reference video URLs or file ids for Seedance 2.0 video-to-video continuity."
    )
    frames: Optional[int] = Field(
        default=None,
        description="Optional frame count for Seedance generation. When provided, it takes priority over duration.",
    )
    duration: Optional[int] = Field(
        default=CANONICAL_VIDEO_DURATION_SECONDS,
        description="Video duration in seconds. Fixed at 15 seconds; any other value will be ignored.",
    )
    aspect_ratio: Optional[str] = Field(default="16:9", description="Video aspect ratio. Supported: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, 2.39:1")
    tool_call_id: Annotated[str, InjectedToolCallId]


class GenerateFirstLastFrameVideoInputSchema(BaseModel):
    prompt: str = Field(description="Text prompt describing the video content and motion")
    first_frame: Optional[str] = Field(
        default=None,
        description="First frame image url (or file id). If omitted, will use the 2nd most recent keyframe.",
    )
    last_frame: Optional[str] = Field(
        default=None,
        description="Last frame image url (or file id). If omitted, will use the most recent keyframe.",
    )
    reference_images: Optional[list[str]] = Field(
        default=None,
        description="Optional additional reference images (URLs or file ids) for Kling O3 multi-reference continuity."
    )
    frames: Optional[int] = Field(
        default=None,
        description="Optional frame count for Seedance generation. When provided, it takes priority over duration.",
    )
    duration: Optional[int] = Field(
        default=CANONICAL_VIDEO_DURATION_SECONDS,
        description="Video duration in seconds. Fixed at 15 seconds; any other value will be ignored.",
    )
    aspect_ratio: Optional[str] = Field(default="16:9", description="Video aspect ratio. Supported: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, 2.39:1")
    tool_call_id: Annotated[str, InjectedToolCallId]


def _build_providers() -> dict:
    providers = {
        'reelmind': ReelMindVideoGenerator(),
    }

    try:
        if GeminiVeoVideoGenerator is not None:
            providers['gemini_veo'] = GeminiVeoVideoGenerator()
    except Exception as exc:
        print(f"🎬 Gemini Veo provider disabled: {exc}")

    return providers


# Initialize provider instances
PROVIDERS = _build_providers()

# Import timeline utilities
from .timeline_utils import (
    build_review_event_from_asset,
    generate_file_id,
    create_video_asset
)

def _extract_image_urls_from_messages(messages: list) -> list[str]:
    urls: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get('content', '')
        if not isinstance(content, str):
            continue
        for match in re.finditer(r'!\[image_(?:url|id):\s*([^\]]+)\]\(([^)]+)\)', content):
            url = match.group(2).strip()
            if url and url not in urls:
                urls.append(url)
    return urls


def _get_last_two_keyframe_urls(canvas_data: dict) -> tuple[Optional[str], Optional[str]]:
    timeline = (canvas_data or {}).get('timeline') or {}
    tracks = timeline.get('tracks') or []
    keyframe_track = next((t for t in tracks if t.get('id') == 'keyframe-track'), None)
    if not keyframe_track:
        return None, None
    assets = keyframe_track.get('assets') or []
    image_urls: list[str] = []
    for asset in assets:
        url = (((asset or {}).get('content') or {}).get('imageUrl')) or (asset or {}).get('imageUrl')
        if url:
            image_urls.append(url)
    if len(image_urls) < 2:
        return (image_urls[-1], None) if image_urls else (None, None)
    return image_urls[-2], image_urls[-1]


def _get_recent_keyframe_urls(canvas_data: dict, limit: int = 4) -> list[str]:
    timeline = (canvas_data or {}).get('timeline') or {}
    tracks = timeline.get('tracks') or []
    keyframe_track = next((t for t in tracks if t.get('id') == 'keyframe-track'), None)
    if not keyframe_track:
        return []
    assets = keyframe_track.get('assets') or []
    urls: list[str] = []
    for asset in reversed(assets):
        url = (((asset or {}).get('content') or {}).get('imageUrl')) or (((asset or {}).get('metadata') or {}).get('resourceUrl'))
        if isinstance(url, str) and url and url not in urls:
            urls.append(url)
        if len(urls) >= limit:
            break
    return urls


def _resolve_image_url(ref: Optional[str], canvas_data: dict) -> Optional[str]:
    if not ref:
        return None
    if isinstance(ref, str) and ref.startswith('http'):
        return ref
    files = (canvas_data or {}).get('files', {})
    if ref in files:
        return files[ref].get('dataURL')
    for file_id, file_data in files.items():
        if ref in file_id or file_id.endswith(ref):
            return file_data.get('dataURL')
    return None


def _resolve_video_url(ref: Optional[str], canvas_data: dict) -> Optional[str]:
    if not ref:
        return None
    if isinstance(ref, str) and ref.startswith('http'):
        return ref
    files = (canvas_data or {}).get('files', {})
    if ref in files:
        return files[ref].get('dataURL')
    for file_id, file_data in files.items():
        if ref in file_id or file_id.endswith(ref):
            return file_data.get('dataURL')
    timeline = (canvas_data or {}).get('timeline') or {}
    tracks = timeline.get('tracks') or []
    video_track = next((t for t in tracks if t.get('id') == 'video-track'), None)
    for asset in (video_track or {}).get('assets') or []:
        asset_id = str((asset or {}).get('id') or '')
        if ref == asset_id or asset_id.endswith(str(ref)):
            return (((asset or {}).get('content') or {}).get('videoUrl')) or (((asset or {}).get('metadata') or {}).get('resourceUrl'))
    return None


def _dedupe_urls(urls: list[str], limit: int = 6) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if not isinstance(url, str):
            continue
        normalized = url.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
        if limit > 0 and len(deduped) >= limit:
            break
    return deduped


def extract_image_url_from_messages(messages: list) -> Optional[str]:
    """
    Extract the most recent image URL from conversation messages

    Args:
        messages: List of conversation messages

    Returns:
        Image URL string or None if no image found
    """
    # Look through messages in reverse order to find the most recent image
    for message in reversed(messages):
        if isinstance(message, dict):
            content = message.get('content', '')
            if isinstance(content, str):
                # Look for image URLs in both user and assistant messages
                # Format: ![image_url: {image_url}]({image_url}) or ![image_id: {file_id}]({image_url})
                image_match = re.search(r'!\[image_(?:url|id):\s*([^\]]+)\]\(([^)]+)\)', content)
                if image_match:
                    image_url = image_match.group(2).strip()
                    print(f"🖼️ Found image URL: {image_url}")
                    return image_url

    return None


@tool("generate_video",
      description="Generate a video using Seedance 2.0 with text-to-video, image-to-video, or video-to-video continuity inputs.",
      args_schema=GenerateVideoInputSchema)
async def generate_video(
    prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    input_image: Optional[str] = None,
    frames: Optional[int] = None,
    duration: Optional[int] = CANONICAL_VIDEO_DURATION_SECONDS,
    aspect_ratio: Optional[str] = "16:9",
    input_images: Optional[list[str]] = None,
    input_videos: Optional[list[str]] = None,
) -> str:
    """
    Generate a video using the specified provider.

    Args:
        prompt (str): The prompt for video generation.
        input_image (str): The input image ID for video generation.
        config (RunnableConfig): The configuration for the runnable.
        tool_call_id (Annotated[str, InjectedToolCallId]): The ID of the tool call.
        duration (Optional[int], optional): Video duration in seconds. Fixed at 15 seconds unless `frames` is provided.
        aspect_ratio (Optional[str], optional): Video aspect ratio. Defaults to "16:9".

    Returns:
        str: Success message with video information.
    """
    try:
        aspect_ratio = normalize_generation_aspect_ratio(aspect_ratio, default="16:9")
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        model_info = config.get('configurable', {}).get('model_info', {})
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        # Force reelmind provider for agent calls - override any existing configuration
        video_model = {'provider': 'reelmind', 'model': 'dreamina-seedance-2-0-260128'}
        
        # Get canvas data to find the image
        canvas = await api_client_service.get_canvas_data(canvas_id)
        if canvas is None:
            canvas = {'data': {}}
        canvas_data = canvas.get('data', {})
        
        messages = config.get('configurable', {}).get('messages', [])
        reference_image_urls: list[str] = []
        reference_video_urls: list[str] = []

        if isinstance(input_images, list):
            for ref in input_images:
                resolved = _resolve_image_url(ref, canvas_data)
                if resolved:
                    reference_image_urls.append(resolved)

        if isinstance(input_videos, list):
            for ref in input_videos:
                resolved = _resolve_video_url(ref, canvas_data)
                if resolved:
                    reference_video_urls.append(resolved)

        primary_input_image_url = _resolve_image_url(input_image, canvas_data)
        if not primary_input_image_url and isinstance(input_image, str) and input_image.startswith('http'):
            primary_input_image_url = input_image

        if primary_input_image_url:
            reference_image_urls.insert(0, primary_input_image_url)

        if len(reference_image_urls) < 2:
            reference_image_urls.extend(_get_recent_keyframe_urls(canvas_data, limit=4))

        if len(reference_image_urls) < 2:
            reference_image_urls.extend(list(reversed(_extract_image_urls_from_messages(messages)[-4:])))

        if len(reference_image_urls) < 2:
            last_message_image = extract_image_url_from_messages(messages)
            if last_message_image:
                reference_image_urls.append(last_message_image)

        reference_image_urls = _dedupe_urls(reference_image_urls, limit=6)
        reference_video_urls = _dedupe_urls(reference_video_urls, limit=WORLD_REFERENCE_VIDEO_LIMIT)
        primary_input_image_url = reference_image_urls[0] if reference_image_urls else None

        print(f"🎬 Using reference images ({len(reference_image_urls)}): {reference_image_urls}")
        print(f"🎬 Using reference videos ({len(reference_video_urls)}): {reference_video_urls}")

        provider = video_model.get('provider', 'reelmind')
        model = video_model.get('model', 'dreamina-seedance-2-0-260128')

        print(f"🎬 Using video provider: {provider}, model: {model}")

        # Get provider instance
        generator = PROVIDERS.get(provider)
        if not generator:
            raise ValueError(f"Unsupported provider: {provider}")

        resolved_frames = int(frames) if isinstance(frames, int) and frames > 0 else None
        if resolved_frames is None and isinstance(frames, str) and frames.strip().isdigit():
            resolved_frames = int(frames.strip())

        if resolved_frames is None:
            # Enforce a single canonical duration across the whole pipeline.
            # Even if the LLM passes another value, we always generate/store as 15 seconds.
            duration = CANONICAL_VIDEO_DURATION_SECONDS
        else:
            duration = resolved_frames / BYTEPLUS_VIDEO_FPS

        try:
            delegated = await _try_delegate_video_to_acp(
                prompt=prompt,
                config=config,
                aspect_ratio=aspect_ratio,
                duration=duration,
                input_image=primary_input_image_url,
                input_images=reference_image_urls or None,
                input_videos=reference_video_urls or None,
                frames=resolved_frames,
            )
            if delegated:
                log_runtime_event(
                    "video.delegated",
                    canvas_id=canvas_id,
                    session_id=session_id,
                    user_id=config.get('configurable', {}).get('user_id', session_id),
                    aspect_ratio=aspect_ratio,
                    duration=duration,
                )
                return delegated
        except Exception as bridge_exc:
            log_runtime_warning(
                "video.delegation_failed_fallback_local",
                canvas_id=canvas_id,
                session_id=session_id,
                user_id=config.get('configurable', {}).get('user_id', session_id),
                error=str(bridge_exc),
            )

        # Generate video using the appropriate provider (model is now fixed internally)
        # Get real user_id from context
        user_id = config.get('configurable', {}).get('user_id', session_id)
        result = await generator.generate(
            prompt=prompt,
            input_image_url=primary_input_image_url,
            image_urls=reference_image_urls or None,
            video_urls=reference_video_urls or None,
            duration=duration,
            frames=resolved_frames,
            aspect_ratio=aspect_ratio,
            user_id=user_id,
            return_details=True,
        )
        mime_type, public_url, provider_data = result
        retry_count = int(provider_data.get("request_attempts", 1) or 1) - 1 if isinstance(provider_data, dict) else 0

        generation_mode = "text_to_video"
        if reference_video_urls:
            generation_mode = "video_to_video"
        elif primary_input_image_url or reference_image_urls:
            generation_mode = "image_to_video"

        file_id = generate_file_id()

        # 创建video资产数据
        video_asset = create_video_asset(
            file_id=file_id,
            public_url=public_url,
            input_image_url=primary_input_image_url,
            aspect_ratio=aspect_ratio,
            mime_type=mime_type,
            prompt=prompt,
            duration=duration,
            last_frame_url=None,
            reference_image_urls=reference_image_urls,
            reference_video_urls=reference_video_urls,
            generation_mode=generation_mode,
        )
        video_asset.setdefault("metadata", {})
        video_asset["metadata"]["requestRetryCount"] = retry_count
        video_asset["metadata"]["requestAttempts"] = int(provider_data.get("request_attempts", 1) or 1) if isinstance(provider_data, dict) else 1
        video_asset["metadata"]["requestId"] = provider_data.get("request_id") if isinstance(provider_data, dict) else None

        # 增量更新：只添加这个资产到video轨道
        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='video',
            asset_data=video_asset,
            user_id=user_id
        )

        # 发送WebSocket更新
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'video_generated',
            'asset': video_asset,
            'video_url': public_url,
            'tool_name': 'generate_video',
        })
        review_event = build_review_event_from_asset(video_asset)
        if review_event:
            await send_session_update(user_id, session_id, canvas_id, review_event)

        return (
            f"video generated successfully ![video_url: {public_url}]({public_url}) "
            f"- Mode: {generation_mode}, Duration: {duration}, Aspect Ratio: {aspect_ratio}, "
            f"ImageRefs: {len(reference_image_urls)}, VideoRefs: {len(reference_video_urls)}, Primary: {primary_input_image_url or 'text-only'}, "
            f"RequestRetries: {retry_count}"
        )

    except Exception as e:
        print(f"Error generating video: {str(e)}")
        traceback.print_exc()
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': str(e)
        })
        return f"video generation failed: {str(e)}"


@tool(
    "generate_video_first_last_frame",
    description="Generate a video from a first frame and last frame, plus optional multi-reference support images.",
    args_schema=GenerateFirstLastFrameVideoInputSchema,
)
async def generate_video_first_last_frame(
    prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    first_frame: Optional[str] = None,
    last_frame: Optional[str] = None,
    frames: Optional[int] = None,
    duration: Optional[int] = CANONICAL_VIDEO_DURATION_SECONDS,
    aspect_ratio: Optional[str] = "16:9",
    reference_images: Optional[list[str]] = None,
) -> str:
    try:
        aspect_ratio = normalize_generation_aspect_ratio(aspect_ratio, default="16:9")
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        resolved_frames = int(frames) if isinstance(frames, int) and frames > 0 else None
        if resolved_frames is None and isinstance(frames, str) and frames.strip().isdigit():
            resolved_frames = int(frames.strip())
        duration = (resolved_frames / BYTEPLUS_VIDEO_FPS) if resolved_frames is not None else CANONICAL_VIDEO_DURATION_SECONDS

        video_model = {'provider': 'reelmind', 'model': 'dreamina-seedance-2-0-260128'}

        canvas = await api_client_service.get_canvas_data(canvas_id)
        if canvas is None:
            canvas = {'data': {}}
        canvas_data = canvas.get('data', {})

        messages = config.get('configurable', {}).get('messages', [])

        first_url = _resolve_image_url(first_frame, canvas_data)
        last_url = _resolve_image_url(last_frame, canvas_data)

        if not first_url or not last_url:
            t_first, t_last = _get_last_two_keyframe_urls(canvas_data)
            first_url = first_url or t_first
            last_url = last_url or t_last

        if not first_url or not last_url:
            extracted = _extract_image_urls_from_messages(messages)
            if len(extracted) >= 2:
                first_url = first_url or extracted[-2]
                last_url = last_url or extracted[-1]

        if not first_url or not last_url:
            return "First-last-frame video generation failed: need two keyframes (first_frame + last_frame)."

        provider = video_model.get('provider', 'reelmind')
        generator = PROVIDERS.get(provider)
        if not generator:
            raise ValueError(f"Unsupported provider: {provider}")

        reference_image_urls: list[str] = [first_url]
        if isinstance(reference_images, list):
            for ref in reference_images:
                resolved = _resolve_image_url(ref, canvas_data)
                if resolved and resolved != last_url:
                    reference_image_urls.append(resolved)
        reference_image_urls = _dedupe_urls(reference_image_urls, limit=6)

        user_id = config.get('configurable', {}).get('user_id', session_id)
        mime_type, public_url = await generator.generate(
            prompt=prompt,
            image_urls=reference_image_urls,
            first_frame_url=first_url,
            last_frame_url=last_url,
            duration=duration,
            frames=resolved_frames,
            aspect_ratio=aspect_ratio,
            user_id=user_id
        )

        file_id = generate_file_id()
        video_asset = create_video_asset(
            file_id=file_id,
            public_url=public_url,
            input_image_url=first_url,
            aspect_ratio=aspect_ratio,
            mime_type=mime_type,
            prompt=prompt,
            duration=duration,
            last_frame_url=last_url,
            reference_image_urls=reference_image_urls,
            generation_mode="first_last_frame",
        )

        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='video',
            asset_data=video_asset,
            user_id=user_id
        )

        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'video_generated',
            'asset': video_asset,
            'video_url': public_url,
            'tool_name': 'generate_video_first_last_frame',
        })
        review_event = build_review_event_from_asset(video_asset)
        if review_event:
            await send_session_update(user_id, session_id, canvas_id, review_event)

        return (
            f"video generated successfully ![video_url: {public_url}]({public_url}) "
            f"- Mode: first_last_frame, Duration: {duration}, References: {len(reference_image_urls)}, First: {first_url}, Last: {last_url}"
        )

    except Exception as e:
        print(f"Error generating first-last-frame video: {str(e)}")
        traceback.print_exc()
        user_id = config.get('configurable', {}).get('user_id', '')
        canvas_id = config.get('configurable', {}).get('canvas_id', '')
        session_id = config.get('configurable', {}).get('session_id', '')
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': str(e)
        })
        return f"first-last-frame video generation failed: {str(e)}"





print('🎬', generate_video.args_schema.model_json_schema())
print('🎬', generate_video_first_last_frame.args_schema.model_json_schema())
