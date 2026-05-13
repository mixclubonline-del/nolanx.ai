from typing import Optional
import os
import traceback
import fal_client
from .base import VideoGenerator, generate_video_id
from services.config_service import config_service
from ..aspect_ratio_utils import normalize_generation_aspect_ratio


class FalAIVideoGenerator(VideoGenerator):
    """fal.ai video generator implementation using kling-video model"""

    def __init__(self):
        """Initialize fal.ai generator with API key configuration"""
        # Set up fal.ai API key from config
        api_key = config_service.app_config.get('fal_ai', {}).get('api_key', '')
        if api_key:
            os.environ['FAL_KEY'] = api_key

    def _validate_duration(self, duration: Optional[int]) -> int:
        """
        Validate and normalize duration for kling-video model
        
        Args:
            duration: Requested duration in seconds
            
        Returns:
            Validated duration (5-10 seconds for kling-video)
        """
        if duration is None:
            return 5  # Default duration
            
        # kling-video typically supports 5-10 seconds
        if duration < 5:
            return 5
        elif duration > 10:
            return 10
        else:
            return duration

    def _validate_aspect_ratio(self, aspect_ratio: Optional[str]) -> str:
        """
        Validate and normalize aspect ratio for kling-video model
        
        Args:
            aspect_ratio: Requested aspect ratio
            
        Returns:
            Validated aspect ratio
        """
        if aspect_ratio is None:
            return "16:9"  # Default aspect ratio
        
        aspect_ratio = normalize_generation_aspect_ratio(aspect_ratio, default="16:9")

        # Common video aspect ratios supported by kling-video
        valid_ratios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]
        
        if aspect_ratio in valid_ratios:
            return aspect_ratio
        else:
            print(f"⚠️ Unsupported aspect ratio {aspect_ratio}, using 16:9")
            return "16:9"

    async def generate(
        self,
        prompt: str,
        model: str,
        input_image_url: str,
        duration: Optional[int] = None,
        aspect_ratio: Optional[str] = None,
        **kwargs
    ) -> tuple[str, str]:
        try:
            # Get API key from config
            api_key = config_service.app_config.get('fal_ai', {}).get('api_key', '')
            if not api_key:
                raise ValueError("Video generation failed: fal.ai API key is not set")

            # Set API key for fal_client
            os.environ['FAL_KEY'] = api_key

            # Use the fixed model for kling-video
            fal_model = "fal-ai/kling-video/v2.1/standard/image-to-video"

            # Validate parameters
            validated_duration = self._validate_duration(duration)
            validated_aspect_ratio = self._validate_aspect_ratio(aspect_ratio)

            # Prepare arguments for fal.ai kling-video model
            arguments = {
                "prompt": prompt,
                "image_url": input_image_url,
                "duration": validated_duration,
                "aspect_ratio": validated_aspect_ratio,
            }

            # Add any additional kwargs
            arguments.update(kwargs)

            print(f'🎬 fal.ai Video API request - Model: {fal_model}, Arguments: {arguments}')

            # Call fal.ai API using async subscribe for better performance
            result = await fal_client.subscribe_async(
                fal_model,
                arguments=arguments,
                with_logs=True,
                on_queue_update=lambda update: print(f"🎬 fal.ai video queue update: {update}")
            )

            print(f'🎬 fal.ai Video API response: {result}')

            # Extract video URL from result
            output_url = None
            if isinstance(result, dict):
                # Try different possible response formats
                if 'video' in result:
                    # Format: {"video": {"url": "..."}} or {"video": "url"}
                    if isinstance(result['video'], dict):
                        output_url = result['video'].get('url')
                    else:
                        output_url = result['video']
                elif 'video_url' in result:
                    # Format: {"video_url": "..."}
                    output_url = result['video_url']
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
                raise Exception(f'fal.ai video generation failed: no output URL found. Response: {result}')

            # Generate unique video ID for logging
            video_id = generate_video_id()
            print('🎬 fal.ai video generation video_id:', video_id)
            print(f'🎬 fal.ai video output URL: {output_url}')

            # 直接使用fal.ai生产的URL，不进行下载和重新上传
            mime_type = 'video/mp4'  # fal.ai通常返回mp4格式
            public_url = output_url

            return mime_type, public_url

        except Exception as e:
            print('Error generating video with fal.ai:', e)
            traceback.print_exc()
            raise e
