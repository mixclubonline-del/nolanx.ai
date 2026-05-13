"""
Gemini Veo 3.0 video generation tools for LangGraph agents.
"""

import uuid
import re
import time
from typing import Optional, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update

# Import video generators
from .vid_generators import GeminiVeoVideoGenerator

# Import timeline utilities
from .timeline_utils import (
    generate_file_id,
    create_video_asset
)

def _build_gemini_veo_provider() -> dict:
    try:
        if GeminiVeoVideoGenerator is None:
            return {}
        return {
            'gemini_veo': GeminiVeoVideoGenerator(),
        }
    except Exception as exc:
        print(f"🎬 Gemini Veo tool disabled: {exc}")
        return {}


# Initialize Gemini Veo provider instance
GEMINI_VEO_PROVIDER = _build_gemini_veo_provider()


class GenerateGeminiVeoVideoInputSchema(BaseModel):
    prompt: str = Field(description="Text prompt describing the video content and motion for Gemini Veo 3.0 text-to-video generation")
    input_image: Optional[str] = Field(
        default=None,
        description="NOTE: Gemini Veo 3.0 currently only supports text-to-video generation. This parameter will be ignored. Use regular video_designer for image-to-video generation."
    )
    tool_call_id: str


@tool(args_schema=GenerateGeminiVeoVideoInputSchema)
async def generate_gemini_veo_video(
    prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    input_image: Optional[str] = None,
) -> str:
    """
    Generate a video using Gemini Veo 3.0 technology.

    This tool uses Google's advanced Veo 3.0 model for high-quality video generation.
    Currently supports TEXT-TO-VIDEO generation only.

    Args:
        prompt: Text description of the video content and desired motion
        input_image: IGNORED - Veo 3.0 currently only supports text-to-video
        config: Runtime configuration
        tool_call_id: Tool call identifier

    Returns:
        Success message with video details
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        user_id = config.get('configurable', {}).get('user_id', '')
        
        print(f'🎬 Gemini Veo video generation request:')
        print(f'   Prompt: {prompt[:100]}...' if len(prompt) > 100 else f'   Prompt: {prompt}')

        # Veo 3.0 only supports text-to-video, ignore input_image
        if input_image:
            print(f'   ⚠️  Input image provided but IGNORED: {input_image}')
            print(f'   ℹ️  Veo 3.0 only supports text-to-video generation')
        print(f'   Mode: Text-to-video generation')

        # Get Gemini Veo generator
        generator = GEMINI_VEO_PROVIDER.get('gemini_veo')
        if generator is None:
            raise ValueError("Gemini Veo is unavailable in local open-source mode. Set GEMINI_API_KEY or disable this tool path.")
        
        # Generate video using Gemini Veo 3.0 (text-to-video only)
        # Note: input_image is ignored as Veo 3.0 only supports text-to-video
        mime_type, public_url = await generator.generate(
            prompt=prompt,
            input_image_url=None,  # Always None for Veo 3.0
            user_id=user_id
        )

        print(f'🎬 Gemini Veo video generated successfully: {public_url}')

        # 创建video资产数据
        file_id = generate_file_id()
        video_asset = create_video_asset(
            file_id=file_id,
            public_url=public_url,
            input_image_url=None,  # Veo 3.0 is text-to-video only
            aspect_ratio="16:9",  # Default aspect ratio
            mime_type=mime_type,
            prompt=prompt,
            duration=8  # Default duration
        )

        # 添加Gemini Veo特定的元数据
        video_asset['metadata'].update({
            'provider': 'gemini_veo',
            'model': 'veo-3.0-generate-preview',
            'inputImage': input_image,  # Store for reference even though ignored
        })
        video_asset['content']['provider'] = 'gemini_veo'
        video_asset['content']['model'] = 'veo-3.0-generate-preview'

        # 增量更新：只添加这个资产到video轨道
        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='video',
            asset_data=video_asset,
            user_id=user_id
        )

        # 发送WebSocket更新
        user_id = config.get('configurable', {}).get('user_id', session_id)
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'video_generated',
            'asset': video_asset,
            'video_url': public_url,
        })

        # Create success message (similar to video_generators.py format)
        success_message = f"video generated successfully ![video_url: {public_url}]({public_url}) - Provider: Gemini Veo 3.0"
        if input_image:
            success_message += f" (Note: Input image ignored - Veo 3.0 text-to-video only)"

        return success_message

    except Exception as e:
        error_message = f"❌ Gemini Veo video generation failed: {str(e)}"
        print(error_message)
        return error_message

