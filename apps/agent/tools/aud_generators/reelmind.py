from typing import Optional, Tuple
import traceback
from .base import AudioGenerator, generate_audio_id
from utils.http_client import HttpClient
from services.config_service import config_service


class ReelMindAudioGenerator(AudioGenerator):
    """ReelMind server audio generator implementation"""

    def __init__(self):
        """Initialize ReelMind audio generator with server configuration"""
        # Get reelmind.server configuration from config.toml
        self.base_url = config_service.get_reelmind_server_url()
        self.api_key = config_service.get_internal_api_key()
        self.api_endpoint = f"{self.base_url}/agent-generation/audio"

    async def generate(
        self,
        prompt: str,
        model: str,
        audio_type: str = "tts",  # "tts" for text-to-speech, "sound_effects" for sound effects
        voice: Optional[str] = None,  # Voice ID for TTS
        **kwargs
    ) -> Tuple[str, str]:
        """
        Generate audio using reelmind.server agent generation API
        
        Args:
            prompt: Text prompt for audio generation
            model: Model name/identifier (ignored, uses fal.ai models)
            audio_type: Type of audio generation ("tts" or "sound_effects")
            voice: Voice ID for TTS (optional)
            **kwargs: Additional parameters
            
        Returns:
            Tuple of (mime_type, public_url)
        """
        try:
            # Get user_id from kwargs or use a default
            user_id = kwargs.get('user_id', 'agent-user')
            
            # Prepare request payload
            payload = {
                "user_id": user_id,
                "prompt": prompt,
                "audio_type": audio_type,
            }
            
            # Add optional parameters
            if voice:
                payload["voice"] = voice
                
            if kwargs.get('duration'):
                payload["duration"] = int(kwargs['duration'])
            elif audio_type == 'sound_effects':
                payload["duration"] = 8  # Default duration for sound effects

            print(f'🎵 ReelMind Audio API request - Payload: {payload}')

            # Make API request to reelmind.server with retry mechanism
            headers = {
                "Content-Type": "application/json",
                "X-API-Key": self.api_key  # Add API key for authentication
            }

            # 音频生成需要较长的超时时间（最多5分钟）
            import httpx
            import asyncio
            audio_timeout = httpx.Timeout(
                connect=30.0,    # 连接超时 30 秒
                read=300.0,      # 读取超时 5 分钟
                write=60.0,      # 写入超时 60 秒
                pool=120.0       # 连接池超时 2 分钟
            )

            # 重试机制处理500错误
            max_retries = 3
            retry_delay = 3  # 秒
            result = None

            for attempt in range(max_retries):
                try:
                    print(f'🎵 ReelMind Audio API attempt {attempt + 1}/{max_retries}')

                    async with HttpClient.create(url=self.api_endpoint, timeout=audio_timeout) as client:
                        response = await client.post(
                            self.api_endpoint,
                            headers=headers,
                            json=payload
                        )

                        if response.status_code == 500:
                            error_msg = f"HTTP {response.status_code}: {response.text}"
                            print(f'🎵 ReelMind Audio API 500 error (attempt {attempt + 1}): {error_msg}')

                            if attempt < max_retries - 1:
                                print(f'🎵 Retrying in {retry_delay} seconds...')
                                await asyncio.sleep(retry_delay)
                                retry_delay *= 2  # 指数退避
                                continue
                            else:
                                raise Exception(f'ReelMind audio generation failed after {max_retries} attempts: {error_msg}')

                        elif response.status_code != 200:
                            error_msg = f"HTTP {response.status_code}: {response.text}"
                            print(f'🎵 ReelMind Audio API error: {error_msg}')
                            raise Exception(f'ReelMind audio generation failed: {error_msg}')

                        result = response.json()
                        print(f'🎵 ReelMind Audio API response: {result}')
                        break  # 成功，跳出重试循环

                except Exception as e:
                    if "500" in str(e) and attempt < max_retries - 1:
                        print(f'🎵 500 error caught, retrying in {retry_delay} seconds...')
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2
                        continue
                    else:
                        raise e

            # Handle response - reelmind.server returns data wrapped in 'data' object
            if result.get('code') != 200:
                error_message = result.get('message', 'Unknown error')
                raise Exception(f'ReelMind audio generation failed: {error_message}')

            data = result.get('data', {})
            if not data.get('success'):
                error_message = data.get('message', 'Unknown error')
                raise Exception(f'ReelMind audio generation failed: {error_message}')

            # Get the audio URL from the response
            audio_url = data.get('url')
            if not audio_url:
                raise Exception('No URL returned from ReelMind server')

            mime_type = data.get('mime_type', 'audio/mpeg')

            print(f'🎵 ReelMind audio generation completed successfully: {audio_url}')
            print(f'🎵 Credits consumed: {data.get("credits_consumed", "unknown")}')

            return mime_type, audio_url

        except Exception as e:
            print(f'🎵 ReelMind audio generation error: {str(e)}')
            traceback.print_exc()
            raise e
