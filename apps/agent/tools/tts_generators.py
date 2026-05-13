"""
Google Genai TTS (Text-to-Speech) generation tools for LangGraph agents.
"""

import os
import time
import tempfile
import wave
from typing import Optional, Annotated, List, Dict
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


class SpeakerConfig(BaseModel):
    speaker: str = Field(description="Speaker name (e.g., 'Joe', 'Jane')")
    voice_name: str = Field(description="Voice name (e.g., 'Kore', 'Puck', 'Charon', 'Fenrir')")


class GenerateTTSInputSchema(BaseModel):
    text: str = Field(description="Text content to convert to speech. Can include speaker labels like 'Joe: Hello there!'")
    speakers: Optional[List[SpeakerConfig]] = Field(
        default=None,
        description="List of speaker configurations for multi-speaker TTS. If not provided, will use single speaker."
    )
    single_voice: Optional[str] = Field(
        default="Puck",
        description="Voice name for single speaker TTS (used when speakers list is not provided)"
    )
    tool_call_id: str


@tool(args_schema=GenerateTTSInputSchema)
async def generate_tts_audio(
    text: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    speakers: Optional[List[SpeakerConfig]] = None,
    single_voice: Optional[str] = "Puck",
) -> str:
    """
    Generate speech audio using Google Genai TTS with multi-speaker support.
    
    Args:
        text: Text content to convert to speech
        speakers: List of speaker configurations for multi-speaker TTS
        single_voice: Voice name for single speaker TTS
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with audio details
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'🎤 TTS generation request:')
        print(f'   Text: {text[:100]}...' if len(text) > 100 else f'   Text: {text}')
        print(f'   Speakers: {len(speakers) if speakers else 0}')
        print(f'   Single voice: {single_voice}')

        # Generate TTS audio
        audio_data = await generate_tts_with_genai(text, speakers, single_voice)
        
        # Save to temporary file
        temp_file_path = await save_audio_to_temp_file(audio_data)
        
        # Upload to R2 storage
        mime_type, public_url = await upload_audio_to_r2(temp_file_path, user_id)
        
        # Clean up temp file
        os.unlink(temp_file_path)
        
        print(f'🎤 TTS audio generated successfully: {public_url}')

        # Create file data
        file_id = generate()
        file_data = {
            'mimeType': mime_type,
            'id': file_id,
            'dataURL': public_url,
            'created': int(time.time() * 1000),
            'audioType': 'tts',
            'provider': 'google_genai',
            'model': 'google/gemini-3-pro-preview',
            'text': text,
            'speakers': [s.dict() for s in speakers] if speakers else None,
            'singleVoice': single_voice,
        }

        # 创建audio资产数据
        audio_asset = create_audio_asset(
            file_id=file_id,
            public_url=public_url,
            audio_type='tts',
            mime_type=mime_type,
            prompt=text,
            duration=8,  # Default TTS duration
            voice=None,  # Google TTS doesn't use simple voice parameter
            provider='google_genai',
            model='google/gemini-3-pro-preview',
            speakers=[s.dict() for s in speakers] if speakers else None,
            singleVoice=single_voice
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
            'tool_name': 'generate_tts_audio',
        })

        speaker_info = f" with {len(speakers)} speakers" if speakers else f" with {single_voice} voice"
        return f"audio generated successfully ![audio_url: {public_url}]({public_url}) - Provider: Google Genai TTS{speaker_info}"

    except Exception as e:
        error_message = f"❌ TTS audio generation failed: {str(e)}"
        print(error_message)
        return error_message


async def generate_tts_with_genai(text: str, speakers: Optional[List[SpeakerConfig]], single_voice: str) -> bytes:
    """Generate TTS audio using Google Genai"""
    try:
        from google import genai
        from google.genai import types
        
        # Get API key from config
        google_genai_config = config_service.get_service_config('google_genai')
        api_key = google_genai_config.get('api_key')
        
        if not api_key:
            raise ValueError("Google Genai API key not found in configuration")
        
        # Create client
        client = genai.Client(api_key=api_key)
        
        # Configure TTS based on speakers
        if speakers and len(speakers) > 1:
            # Multi-speaker TTS
            speaker_voice_configs = []
            for speaker_config in speakers:
                speaker_voice_configs.append(
                    types.SpeakerVoiceConfig(
                        speaker=speaker_config.speaker,
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=speaker_config.voice_name,
                            )
                        )
                    )
                )
            
            speech_config = types.SpeechConfig(
                multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                    speaker_voice_configs=speaker_voice_configs
                )
            )
        else:
            # Single speaker TTS
            speech_config = types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=single_voice,
                    )
                )
            )
        
        # Generate TTS
        response = client.models.generate_content(
            model="google/gemini-3-pro-preview",
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=speech_config
            )
        )
        
        # Extract audio data
        audio_data = response.candidates[0].content.parts[0].inline_data.data
        return audio_data
        
    except Exception as e:
        print(f'🎤 TTS generation error: {str(e)}')
        raise e


async def save_audio_to_temp_file(audio_data: bytes) -> str:
    """Save audio data to temporary WAV file"""
    try:
        # Create temporary file
        temp_fd, temp_file_path = tempfile.mkstemp(suffix='.wav')
        os.close(temp_fd)
        
        # Save as WAV file
        with wave.open(temp_file_path, "wb") as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(24000)  # 24kHz
            wf.writeframes(audio_data)
        
        return temp_file_path
        
    except Exception as e:
        print(f'🎤 Error saving audio to temp file: {str(e)}')
        raise e


async def upload_audio_to_r2(temp_file_path: str, user_id: str = None) -> tuple[str, str]:
    """Upload audio file to R2 storage"""
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
            file_key = f"gen_audio_task/user_{user_id}/tts_{task_id}.wav"
        else:
            file_key = f"gen_audio_task/tts_{task_id}.wav"
        
        print(f'🎤 Uploading audio to R2: {file_key}')
        
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
            public_url = f"{R2_CONFIG['PUBLIC_URL']}/gen_audio_task/user_{user_id}/tts_{task_id}.wav"
        else:
            public_url = f"{R2_CONFIG['PUBLIC_URL']}/gen_audio_task/tts_{task_id}.wav"
        
        print(f'🎤 Audio uploaded successfully to R2: {public_url}')
        return 'audio/wav', public_url

    except Exception as e:
        print(f'🎤 Audio upload to R2 failed: {str(e)}')
        raise e


