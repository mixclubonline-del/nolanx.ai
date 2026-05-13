from typing import Optional
import os
import traceback
import fal_client
from .base import AudioGenerator, generate_audio_id
from .voice_selector import voice_selector
from services.config_service import config_service


class FalAIAudioGenerator(AudioGenerator):
    """fal.ai audio generator implementation"""

    def __init__(self):
        """Initialize fal.ai generator with API key configuration"""
        # Set up fal.ai API key from config
        api_key = config_service.app_config.get('fal_ai', {}).get('api_key', '')
        if api_key:
            os.environ['FAL_KEY'] = api_key

    def _get_model_for_type(self, audio_type: str, model: str = None) -> str:
        """
        Get the appropriate fal.ai model based on audio type
        
        Args:
            audio_type: "tts" for text-to-speech, "sound_effects" for sound effects
            model: Optional specific model override
            
        Returns:
            fal.ai model identifier
        """
        if model:
            return model
            
        if audio_type == "tts":
            return "fal-ai/elevenlabs/tts/turbo-v2.5"
        elif audio_type == "sound_effects":
            return "fal-ai/elevenlabs/sound-effects"
        else:
            raise ValueError(f"Unsupported audio type: {audio_type}")

    def _select_best_voice(self, prompt: str, audio_type: str, voice: Optional[str] = None) -> Optional[str]:
        """
        Select the best voice for TTS based on content analysis

        Args:
            prompt: The text to be spoken
            audio_type: Type of audio generation
            voice: Optional specific voice override

        Returns:
            Selected voice ID or None
        """
        if audio_type != "tts":
            return None

        # If voice is explicitly specified, use it
        if voice:
            return voice

        # Use intelligent voice selection
        try:
            voice_id, voice_name, reasons = voice_selector.select_best_voice(prompt)
            print(f"🎵 Intelligent voice selection: {voice_name} ({voice_id})")
            print(f"   Selection reasons: {', '.join(reasons)}")
            return voice_id
        except Exception as e:
            print(f"⚠️ Voice selection failed, using default: {e}")
            return "21m00Tcm4TlvDq8ikWAM"  # Rachel as fallback

    async def generate(
        self,
        prompt: str,
        model: str,
        audio_type: str = "tts",
        voice: Optional[str] = None,
        **kwargs
    ) -> tuple[str, str]:
        try:
            # Get API key from config
            api_key = config_service.app_config.get('fal_ai', {}).get('api_key', '')
            if not api_key:
                raise ValueError("Audio generation failed: fal.ai API key is not set")

            # Set API key for fal_client
            os.environ['FAL_KEY'] = api_key

            # Get the appropriate model
            fal_model = self._get_model_for_type(audio_type, model)

            # Prepare arguments for fal.ai
            arguments = {
                "text": prompt,
            }

            # Add voice for TTS with intelligent selection
            if audio_type == "tts":
                voice_id = self._select_best_voice(prompt, audio_type, voice)
                if voice_id:
                    arguments["voice"] = voice_id
                
                # Add TTS-specific parameters
                arguments.update({
                    "model_id": "eleven_turbo_v2_5",  # Use the turbo model
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.8,
                        "style": 0.0,
                        "use_speaker_boost": True
                    }
                })
            elif audio_type == "sound_effects":
                # Add sound effects specific parameters
                arguments.update({
                    "duration_seconds": kwargs.get("duration", 8),  # Default 8 seconds
                    "prompt_influence": kwargs.get("prompt_influence", 0.3)
                })

            # Add any additional kwargs
            arguments.update(kwargs)

            print(f'🎵 fal.ai Audio API request - Model: {fal_model}, Type: {audio_type}, Arguments: {arguments}')

            # Call fal.ai API using async subscribe for better performance
            result = await fal_client.subscribe_async(
                fal_model,
                arguments=arguments,
                with_logs=True,
                on_queue_update=lambda update: print(f"🎵 fal.ai queue update: {update}")
            )

            print(f'🎵 fal.ai Audio API response: {result}')

            # Extract audio URL from result
            output_url = None
            if isinstance(result, dict):
                # Try different possible response formats
                if 'audio_url' in result:
                    # Format: {"audio_url": "..."}
                    output_url = result['audio_url']
                elif 'audio' in result:
                    # Format: {"audio": {"url": "..."}} or {"audio": "url"}
                    if isinstance(result['audio'], dict):
                        output_url = result['audio'].get('url')
                    else:
                        output_url = result['audio']
                elif 'url' in result:
                    # Format: {"url": "..."}
                    output_url = result['url']
                elif 'output' in result:
                    # Format: {"output": "url"} or {"output": {"url": "..."}}
                    if isinstance(result['output'], dict):
                        output_url = result['output'].get('url')
                    elif isinstance(result['output'], str):
                        output_url = result['output']

            if not output_url:
                raise Exception(f'fal.ai audio generation failed: no output URL found. Response: {result}')

            # Generate unique audio ID
            print(f'🎵 fal.ai audio output URL: {output_url}')

            # 直接使用fal.ai生成的URL，不进行下载和重新上传
            mime_type = 'audio/mpeg'  # fal.ai通常返回mp3格式
            public_url = output_url

            return mime_type, public_url

        except Exception as e:
            print('Error generating audio with fal.ai:', e)
            traceback.print_exc()
            raise e
