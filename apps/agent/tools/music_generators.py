"""
Google Genai Music generation tools for LangGraph agents.
"""

import os
import time
import tempfile
import asyncio
import uuid
from typing import Optional, Annotated, List
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


# Import timeline utilities
from .timeline_utils import (
    generate_file_id,
    create_audio_asset
)


class GenerateMusicInputSchema(BaseModel):
    prompt: str = Field(description="Music style description (e.g., 'minimal techno', 'jazz piano', 'ambient electronic')")
    bpm: Optional[int] = Field(
        default=120,
        description="Beats per minute (60-180). Default: 120"
    )
    temperature: Optional[float] = Field(
        default=1.0,
        description="Creativity level (0.1-2.0). Higher = more creative. Default: 1.0"
    )
    duration: Optional[int] = Field(
        default=8,
        description="Music duration in seconds (10-60). Default: 8"
    )
    tool_call_id: str


@tool(args_schema=GenerateMusicInputSchema)
async def generate_music(
    prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    bpm: Optional[int] = 120,
    temperature: Optional[float] = 1.0,
    duration: Optional[int] = 8,
) -> str:
    """
    Generate music using Google Genai Lyria real-time music generation.
    
    Args:
        prompt: Music style description
        bpm: Beats per minute
        temperature: Creativity level
        duration: Music duration in seconds
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with music details
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'🎵 Music generation request:')
        print(f'   Prompt: {prompt}')
        print(f'   BPM: {bpm}')
        print(f'   Temperature: {temperature}')
        print(f'   Duration: {duration}')

        # Generate music
        audio_data = await generate_music_with_genai(prompt, bpm, temperature, duration)
        
        # Save to temporary file
        temp_file_path = await save_music_to_temp_file(audio_data)
        
        # Upload to R2 storage
        mime_type, public_url = await upload_music_to_r2(temp_file_path, user_id)
        
        # Clean up temp file
        os.unlink(temp_file_path)
        
        print(f'🎵 Music generated successfully: {public_url}')

        # Create file data
        file_id = generate()
        file_data = {
            'mimeType': mime_type,
            'id': file_id,
            'dataURL': public_url,
            'created': int(time.time() * 1000),
            'audioType': 'music',
            'provider': 'google_genai',
            'model': 'lyria-realtime-exp',
            'prompt': prompt,
            'bpm': bpm,
            'temperature': temperature,
            'duration': duration,
        }

        # 创建audio资产数据（音乐作为audio类型）
        music_asset = create_audio_asset(
            file_id=file_id,
            public_url=public_url,
            audio_type='music',
            mime_type='audio/wav',
            prompt=prompt,
            duration=duration,
            bpm=bpm,
            temperature=temperature
        )

        # 增量更新：只添加这个资产到audio轨道
        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='audio',
            asset_data=music_asset,
            user_id=user_id
        )

        # 发送WebSocket更新
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'music_generated',
            'asset': music_asset,
            'audio_url': public_url,
        })

        # Create success message
        success_message = f"music generated successfully ![audio_url: {public_url}]({public_url}) - Provider: Google Genai Lyria ({prompt}, {bpm} BPM, {duration})"

        return success_message

    except Exception as e:
        error_message = f"❌ Music generation failed: {str(e)}"
        print(error_message)
        return error_message


async def generate_music_with_genai(prompt: str, bpm: int, temperature: float, duration: int) -> bytes:
    """Generate music using Google Genai Lyria"""
    try:
        from google import genai
        from google.genai import types
        
        # Get API key from config
        google_genai_config = config_service.get_service_config('google_genai')
        api_key = google_genai_config.get('api_key')

        if not api_key:
            raise ValueError("Google Genai API key not found in configuration")
        
        # Create client with v1alpha API
        client = genai.Client(api_key=api_key, http_options={'api_version': 'v1alpha'})
        
        # Collect audio chunks
        audio_chunks = []
        
        async def receive_audio(session):
            """Background task to process incoming audio."""
            nonlocal audio_chunks
            start_time = time.time()
            while time.time() - start_time < duration:
                async for message in session.receive():
                    if hasattr(message, 'server_content') and hasattr(message.server_content, 'audio_chunks'):
                        for chunk in message.server_content.audio_chunks:
                            audio_chunks.append(chunk.data)
                    await asyncio.sleep(0.001)  # Small delay to prevent busy waiting
                
                # Break if we have enough audio or timeout
                if time.time() - start_time >= duration:
                    break
        
        # Generate music using live streaming
        async with (
            client.aio.live.music.connect(model='models/lyria-realtime-exp') as session,
            asyncio.TaskGroup() as tg,
        ):
            # Set up task to receive server messages
            tg.create_task(receive_audio(session))
            
            # Send initial prompts and config
            await session.set_weighted_prompts(
                prompts=[
                    types.WeightedPrompt(text=prompt, weight=1.0),
                ]
            )
            await session.set_music_generation_config(
                config=types.LiveMusicGenerationConfig(
                    bpm=bpm, 
                    temperature=temperature
                )
            )
            
            # Start streaming music
            await session.play()
            
            # Wait for the specified duration
            await asyncio.sleep(duration)
        
        # Combine all audio chunks
        if audio_chunks:
            combined_audio = b''.join(audio_chunks)
            return combined_audio
        else:
            raise Exception("No audio data received from Lyria")
        
    except Exception as e:
        print(f'🎵 Music generation error: {str(e)}')
        raise e


async def save_music_to_temp_file(audio_data: bytes) -> str:
    """Save music data to temporary file"""
    try:
        # Create temporary file
        temp_fd, temp_file_path = tempfile.mkstemp(suffix='.wav')
        os.close(temp_fd)
        
        # Write raw audio data (assuming it's already in a playable format)
        with open(temp_file_path, 'wb') as f:
            f.write(audio_data)
        
        return temp_file_path
        
    except Exception as e:
        print(f'🎵 Error saving music to temp file: {str(e)}')
        raise e


async def upload_music_to_r2(temp_file_path: str, user_id: str = None) -> tuple[str, str]:
    """Upload music file to R2 storage"""
    try:
        import boto3
        from botocore.config import Config
        
        # 从配置服务获取R2配置信息
        r2_config = config_service.get_service_config('r2_storage')
        R2_CONFIG = {
            'ACCOUNT_ID': r2_config.get('account_id'),
            'ACCESS_KEY_ID': r2_config.get('access_key_id'),
            'SECRET_ACCESS_KEY': r2_config.get('secret_access_key'),
            'BUCKET_NAME': r2_config.get('bucket_name'),
            'PUBLIC_URL': r2_config.get('public_url')
        }
        
        # Create R2 client
        r2_client = boto3.client(
            's3',
            endpoint_url=f"https://{R2_CONFIG['ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=R2_CONFIG['ACCESS_KEY_ID'],
            aws_secret_access_key=R2_CONFIG['SECRET_ACCESS_KEY'],
            config=Config(
                region_name='auto',
                retries={'max_attempts': 3}
            )
        )
        
        # Generate unique filename
        task_id = generate()
        
        # Create file key path
        if user_id:
            file_key = f"gen_audio_task/user_{user_id}/music_{task_id}.wav"
        else:
            file_key = f"gen_audio_task/music_{task_id}.wav"
        
        print(f'🎵 Uploading music to R2: {file_key}')
        
        # Upload file to R2
        with open(temp_file_path, 'rb') as file:
            r2_client.upload_fileobj(
                file,
                R2_CONFIG['BUCKET_NAME'],
                file_key,
                ExtraArgs={
                    'ContentType': 'audio/wav',
                    'ACL': 'public-read'
                }
            )
        
        # Generate public URL
        if user_id:
            public_url = f"{R2_CONFIG['PUBLIC_URL']}/gen_audio_task/user_{user_id}/music_{task_id}.wav"
        else:
            public_url = f"{R2_CONFIG['PUBLIC_URL']}/gen_audio_task/music_{task_id}.wav"
        
        print(f'🎵 Music uploaded successfully to R2: {public_url}')
        return 'audio/wav', public_url

    except Exception as e:
        print(f'🎵 Music upload to R2 failed: {str(e)}')
        raise e


async def generate_new_music_element(canvas_id: str, file_id: str, music_data: dict):
    """Generate a new music element for the canvas"""
    canvas = await api_client_service.get_canvas_data(canvas_id)
    if canvas is None:
        canvas = {'data': {}}
    canvas_data = canvas.get('data', {})
    if canvas_data is None:
        canvas_data = {}
    elements = canvas_data.get('elements', [])

    # Find the last audio element or any element to position the new one
    last_x = 0
    last_y = 0
    last_width = 0
    last_height = 0

    for element in elements:
        if element.get('type') == 'audio':
            last_x = element.get('x', 0)
            last_y = element.get('y', 0)
            last_width = element.get('width', 350)
            last_height = element.get('height', 120)
        elif element.get('type') in ['video', 'image']:
            last_x = element.get('x', 0)
            last_y = element.get('y', 0)
            last_width = element.get('width', 350)
            last_height = element.get('height', 120)

    # Calculate new position (offset from last element)
    new_x = last_x + last_width + 20 if last_width > 0 else 100
    new_y = last_y if last_y > 0 else 100

    # Default music player dimensions (slightly larger than TTS)
    width = 350
    height = 120

    new_music_element = {
        'type': 'audio',
        'id': generate(),
        'x': new_x,
        'y': new_y,
        'width': width,
        'height': height,
        'fileId': file_id,
        'audioUrl': music_data.get('dataURL'),
        'provider': 'google_genai',
        'model': 'lyria-realtime-exp',
        'prompt': music_data.get('prompt'),
        'bpm': music_data.get('bpm'),
        'temperature': music_data.get('temperature'),
        'duration': music_data.get('duration'),
        'audioType': 'music',
        'created': music_data.get('created', int(time.time() * 1000)),
    }

    return new_music_element
