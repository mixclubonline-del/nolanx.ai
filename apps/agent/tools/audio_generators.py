import random
import json
import time
import traceback
import uuid
from typing import Optional, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update

# Import all generators
from .aud_generators import (
    # FalAIAudioGenerator,
    ReelMindAudioGenerator,
)

# 生成唯一文件 ID (现在使用UUID格式)
def generate_file_id():
    return str(uuid.uuid4())


class GenerateAudioInputSchema(BaseModel):
    prompt: str = Field(
        description="Required. The text prompt for audio generation. For TTS (text-to-speech), this should be the text to be spoken. For sound effects, this should describe the sound you want to generate.")
    audio_type: str = Field(
        description="Required. Type of audio generation. Use 'tts' for text-to-speech/voiceover, or 'sound_effects' for generating sound effects. Choose 'tts' when user wants voiceover, narration, or spoken content. Choose 'sound_effects' when user wants background sounds, ambient audio, or sound effects.")
    voice: Optional[str] = Field(default=None, description="Optional. Voice ID for text-to-speech. If not specified, a default voice will be used. Only applicable when audio_type is 'tts'.")
    duration: Optional[int] = Field(default=8, description="Duration in seconds. Fixed at 8 seconds; any other value will be ignored.")
    tool_call_id: Annotated[str, InjectedToolCallId]


# Initialize provider instances
PROVIDERS = {
    # 'fal_ai': FalAIAudioGenerator(),
    'reelmind': ReelMindAudioGenerator(),
}

# Import timeline utilities
from .timeline_utils import (
    build_review_event_from_asset,
    generate_file_id,
    create_audio_asset
)


@tool("generate_audio",
      description="Generate audio using text prompt. Can generate text-to-speech (voiceover/narration) or sound effects based on the audio_type parameter.",
      args_schema=GenerateAudioInputSchema)
async def generate_audio(
    prompt: str,
    audio_type: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    voice: Optional[str] = None,
    duration: Optional[int] = 8,
) -> str:
    """
    Generate audio using the specified provider.

    Args:
        prompt (str): The text prompt for audio generation.
        audio_type (str): Type of audio generation ('tts' or 'sound_effects').
        config (RunnableConfig): The configuration for the runnable.
        tool_call_id (Annotated[str, InjectedToolCallId]): The ID of the tool call.
        voice (Optional[str], optional): Voice ID for TTS. Defaults to None.
        duration (Optional[int], optional): Duration for sound effects. Fixed at 8 seconds.

    Returns:
        str: Success message with audio information.
    """
    print('🎵 tool_call_id', tool_call_id)
    # 防御性编程：检查config是否为None
    if config is None:
        raise ValueError("Config parameter is None")

    ctx = config.get('configurable', {})
    canvas_id = ctx.get('canvas_id', '')
    session_id = ctx.get('session_id', '')
    user_id = ctx.get('user_id', '')
    print('🎵 canvas_id', canvas_id, 'session_id', session_id, 'user_id', user_id)
    # Inject the tool call id into the context
    ctx['tool_call_id'] = tool_call_id

    # Validate audio_type
    if audio_type not in ['tts', 'sound_effects']:
        raise ValueError("audio_type must be either 'tts' or 'sound_effects'")

    # Force reelmind provider for agent calls - override any existing configuration
    audio_model = {'provider': 'reelmind', 'model': ''}

    provider = audio_model.get('provider', 'reelmind')
    model = audio_model.get('model', '')

    print(f"🎵 Using audio provider: {provider}, model: {model}")

    # Get provider instance
    generator = PROVIDERS.get(provider)
    if not generator:
        raise ValueError(f"Unsupported provider: {provider}")

    try:
        # Enforce a single canonical duration across the whole pipeline.
        # Even if the LLM passes 5/10, we always generate/store as 8 seconds.
        duration = 8

        # Generate audio using the appropriate provider
        extra_kwargs = {}
        if audio_type == 'sound_effects':
            extra_kwargs['duration'] = duration

        # Get real user_id from context
        user_id = ctx.get('user_id', session_id)
        mime_type, public_url = await generator.generate(
            prompt=prompt,
            model=model,
            audio_type=audio_type,
            voice=voice,
            user_id=user_id,
            **extra_kwargs
        )

        file_id = generate_file_id()

        # 创建audio资产数据
        audio_duration = 8

        audio_asset = create_audio_asset(
            file_id=file_id,
            public_url=public_url,
            audio_type=audio_type,
            mime_type=mime_type,
            prompt=prompt,
            duration=audio_duration,
            voice=voice
        )

        # 增量更新：只添加这个资产到audio轨道
        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='audio',
            asset_data=audio_asset,
            user_id=user_id
        )

        # 发送WebSocket更新
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'audio_generated',
            'asset': audio_asset,
            'audio_url': public_url,
            'tool_name': 'generate_audio',
        })
        review_event = build_review_event_from_asset(audio_asset)
        if review_event:
            await send_session_update(user_id, session_id, canvas_id, review_event)

        audio_type_display = "voiceover" if audio_type == "tts" else "sound effects"
        return f"{audio_type_display} generated successfully ![audio_url: {public_url}]({public_url})"

    except Exception as e:
        print(f"Error generating audio: {str(e)}")
        traceback.print_exc()
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': str(e)
        })
        return f"audio generation failed: {str(e)}"

print('🎵', generate_audio.args_schema.model_json_schema())
