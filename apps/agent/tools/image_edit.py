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
from services.websocket_service import send_session_update
from services.nolanx.runtime_capabilities import get_runtime_capability_flags

# Import timeline utilities
from .timeline_utils import (
    generate_file_id,
    create_keyframe_asset
)
from .aspect_ratio_utils import normalize_generation_aspect_ratio

from .img_generators import FalAIGenerator, MissingProviderConfigurationError

# 生成唯一文件 ID (现在使用UUID格式)
def generate_file_id():
    return str(uuid.uuid4())


class EditImageInputSchema(BaseModel):
    prompt: str = Field(description="Text prompt describing the desired changes to the image")
    input_image: Optional[str] = Field(
        default=None,
        description=(
            "Image URL (or file id) to edit. If omitted, will use the most recent keyframe on the canvas timeline "
            "or the last image URL found in conversation."
        ),
    )
    input_images: Optional[list[str]] = Field(
        default=None,
        description=(
            "Optional additional reference images (URLs or file ids). "
            "If provided and `input_image` is omitted, the first valid entry will be used as the primary input image."
        ),
    )
    aspect_ratio: Optional[str] = Field(default="1:1", description="Aspect ratio for the edited image. Supported: 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 2.39:1")
    tool_call_id: Annotated[str, InjectedToolCallId]


# Initialize provider instances
PROVIDERS = {
    'fal_ai': FalAIGenerator(),
}


@tool("edit_image",
      description="Edit an existing image using text prompt. Provide input_image (or input_images) as reference.",
      args_schema=EditImageInputSchema)
async def edit_image(
    prompt: str,
    input_image: Optional[str],
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    aspect_ratio: Optional[str] = "1:1",
    input_images: Optional[list[str]] = None,
) -> str:
    """
    Edit an existing image using the specified provider.

    Args:
        prompt (str): The prompt for image editing.
        input_image (str): The input image URL to edit (required).
        config (RunnableConfig): The configuration for the runnable.
        tool_call_id (Annotated[str, InjectedToolCallId]): The ID of the tool call.
        aspect_ratio (Optional[str], optional): Aspect ratio of the edited image. Defaults to "1:1".

    Returns:
        str: Success message with edited image information.
    """
    try:
        aspect_ratio = normalize_generation_aspect_ratio(aspect_ratio, default="1:1")
        ctx = config.get('configurable', {})
        canvas_id = ctx.get('canvas_id')
        session_id = ctx.get('session_id')
        user_id = ctx.get('user_id')
        model_info = ctx.get('model_info', {})

        if not canvas_id or not session_id or not user_id:
            raise ValueError("Canvas ID, Session ID, and User ID are required")

        if not get_runtime_capability_flags().get("image_ready"):
            message = "image edit unavailable: add an Image API key in Runtime Keys before retrying."
            await send_session_update(user_id, session_id, canvas_id, {
                'type': 'error',
                'error': message,
            })
            return message

        print(f'🎨 Image edit for user: {user_id}, session: {session_id}, canvas: {canvas_id}')

        # Get canvas data (same structure as image_generators.py)
        canvas = await api_client_service.get_canvas_data(canvas_id)
        if canvas is None:
            canvas = {'data': {}}
        if 'data' not in canvas:
            canvas['data'] = {}
        canvas_data = canvas['data']

        def _resolve_image_ref(ref: Optional[str]) -> Optional[str]:
            if not ref or not isinstance(ref, str):
                return None
            ref = ref.strip()
            if not ref:
                return None
            if ref.startswith("http"):
                return ref
            files = (canvas_data or {}).get("files", {}) or {}
            if ref in files:
                return (files[ref] or {}).get("dataURL")
            for file_id, file_data in files.items():
                if ref in file_id or file_id.endswith(ref):
                    return (file_data or {}).get("dataURL")
            return None

        def _last_keyframe_url() -> Optional[str]:
            timeline = (canvas_data or {}).get("timeline") or {}
            tracks = timeline.get("tracks") or []
            keyframe_track = next((t for t in tracks if t.get("id") == "keyframe-track"), None)
            if not keyframe_track:
                return None
            assets = keyframe_track.get("assets") or []
            if not assets:
                return None
            last = assets[-1]
            return ((last.get("content") or {}).get("imageUrl")) or ((last.get("metadata") or {}).get("resourceUrl"))

        def _extract_last_image_url_from_messages() -> Optional[str]:
            messages = (config.get('configurable', {}) or {}).get('messages', []) or []
            for message in reversed(messages):
                if not isinstance(message, dict):
                    continue
                content = message.get("content", "")
                if not isinstance(content, str):
                    continue
                match = re.search(r'!\\[image_(?:url|id):\\s*[^\\]]+\\]\\(([^)]+)\\)', content)
                if match:
                    return match.group(1).strip()
                url = re.search(r'https?://\\S+\\.(?:png|jpg|jpeg|webp)', content, re.IGNORECASE)
                if url:
                    return url.group(0).strip()
            return None

        # Resolve primary + additional reference images.
        resolved_inputs: list[str] = []
        if isinstance(input_images, list):
            for img in input_images:
                url = _resolve_image_ref(img)
                if url:
                    resolved_inputs.append(url)

        resolved_input_image_url = _resolve_image_ref(input_image)
        if resolved_input_image_url:
            resolved_inputs = [resolved_input_image_url] + [u for u in resolved_inputs if u != resolved_input_image_url]

        if not resolved_input_image_url and resolved_inputs:
            resolved_input_image_url = resolved_inputs[0]

        if not resolved_input_image_url:
            resolved_input_image_url = _last_keyframe_url() or _extract_last_image_url_from_messages()
            if resolved_input_image_url:
                resolved_inputs = [resolved_input_image_url] + [u for u in resolved_inputs if u != resolved_input_image_url]

        if not resolved_input_image_url:
            raise ValueError(
                "Input image is required for image editing. No input_image/input_images provided and no prior keyframe/image found."
            )

        # De-dup while preserving order.
        seen: set[str] = set()
        deduped: list[str] = []
        for u in resolved_inputs:
            if not u or u in seen:
                continue
            seen.add(u)
            deduped.append(u)
        resolved_inputs = deduped

        # Open-source build uses fal.ai GPT Image 2 for image editing as well.
        provider_name = 'fal_ai'
        fal_cfg = config_service.get_service_config('fal_ai') or {}
        model = (
            fal_cfg.get('image_edit_model')
            or fal_cfg.get('image_model')
            or 'openai/gpt-image-2'
        )
        
        generator = PROVIDERS.get(provider_name)
        if not generator:
            raise ValueError(f"Provider '{provider_name}' not found")

        print(f'🎨 Starting image edit with provider: {provider_name}')
        print(f'   Prompt: {prompt}')
        print(f'   Input image: {resolved_input_image_url}')
        if len(resolved_inputs) > 1:
            print(f'   Input images: {resolved_inputs}')
        print(f'   Aspect ratio: {aspect_ratio}')

        # Generate unique file ID
        file_id = generate_file_id()

        # Send initial status
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'image_edit_start',
            'data': {
                'tool_call_id': tool_call_id,
                'file_id': file_id,
                'prompt': prompt,
                'input_image': resolved_input_image_url,
                'input_images': resolved_inputs if len(resolved_inputs) > 1 else None,
                'aspect_ratio': aspect_ratio,
                'provider': provider_name,
                'model': model
            }
        })

        # Get context for user_id
        ctx = config.get('configurable', {})

        # Get real user_id from context
        user_id = ctx.get('user_id', session_id)
        try:
            mime_type, width, height, filename = await generator.generate(
                prompt=prompt,
                model=model,
                aspect_ratio=aspect_ratio,
                input_image=resolved_input_image_url,
                user_id=user_id,
            )
        except MissingProviderConfigurationError:
            message = "image edit unavailable: add an Image API key in Runtime Keys before retrying."
            await send_session_update(user_id, session_id, canvas_id, {
                'type': 'error',
                'error': message,
            })
            return message

        print(f'🎨 Image edit completed: {filename}')

        # Create file data (same structure as image_generators.py)
        file_data = {
            'mimeType': mime_type,
            'id': file_id,
            'dataURL': filename,  # Use the public URL from reelmind.server
            'created': int(time.time() * 1000),
        }

        # 创建keyframe资产数据（编辑后的图片）
        keyframe_asset = create_keyframe_asset(
            file_id=file_id,
            public_url=filename,
            width=width,
            height=height,
            mime_type=mime_type,
            prompt=f"Edited: {prompt}" if prompt else "Image edited",
            duration=8
        )

        # 增量更新：只添加这个资产到keyframe轨道
        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='keyframe',
            asset_data=keyframe_asset,
            user_id=user_id
        )

        # 发送WebSocket更新
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'image_generated',  # Use same event type as image_generators
            'asset': keyframe_asset,
            'image_url': filename,
            'tool_name': 'edit_image',
        })

        return f"image edited successfully ![image_url: {filename}]({filename})"

    except Exception as e:
        error_message = f"Image edit failed: {str(e)}"
        print(f'❌ {error_message}')
        print(f'Stack trace: {traceback.format_exc()}')
        
        # Send error status
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'image_edit_error',
            'data': {
                'tool_call_id': tool_call_id,
                'error': error_message
            }
        })
        
        return f"❌ {error_message}"
