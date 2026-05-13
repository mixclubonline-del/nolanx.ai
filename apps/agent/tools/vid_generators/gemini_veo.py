from typing import Optional, Tuple
import traceback
import time
import asyncio
import tempfile
import os
from .base import VideoGenerator, generate_video_id
from services.config_service import config_service


class GeminiVeoVideoGenerator(VideoGenerator):
    """Gemini Veo 3.0 video generator implementation using official Google Genai API"""

    def __init__(self):
        """Initialize Gemini Veo video generator with API configuration"""
        # Get Gemini configuration from config.toml
        gemini_config = config_service.app_config.get('gemini', {})
        self.api_key = gemini_config.get('api_key', '')
        
        if not self.api_key:
            raise ValueError("Gemini API key not found in configuration")
        
        # Gemini Veo API endpoint (using official Google Genai API)
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.model_name = "veo-3.0-generate-preview"
        
        print(f'🎬 Gemini Veo video generator initialized with API key: ***{self.api_key[-4:]}')

    def _validate_duration(self, duration: Optional[int]) -> int:
        """Validate and return duration in seconds"""
        if duration is None:
            return 5  # Default 5 seconds
        
        # Veo 3.0 supports various durations, typically 5-30 seconds
        if duration < 1:
            return 1
        elif duration > 30:
            return 30
        return duration

    def _validate_aspect_ratio(self, aspect_ratio: Optional[str]) -> str:
        """Validate and return aspect ratio"""
        if aspect_ratio is None:
            return "16:9"  # Default aspect ratio
        
        # Veo 3.0 supported aspect ratios
        supported_ratios = ["16:9", "9:16", "1:1", "4:3", "3:4"]
        if aspect_ratio in supported_ratios:
            return aspect_ratio
        
        print(f'🎬 Unsupported aspect ratio {aspect_ratio}, using default 16:9')
        return "16:9"

    async def _create_genai_client(self):
        """Create and configure Google Genai client"""
        try:
            from google import genai
            from google.genai import types
            
            # Configure the client with API key
            client = genai.Client(api_key=self.api_key)
            return client, types
        except ImportError:
            raise Exception("google-genai package not installed. Please install with: pip install google-genai")
        except Exception as e:
            raise Exception(f"Failed to create Gemini client: {str(e)}")

    async def _poll_operation(self, client, operation, max_wait_time: int = 600):
        """Poll operation status until completion"""
        start_time = time.time()
        
        while not operation.done:
            elapsed_time = time.time() - start_time
            if elapsed_time > max_wait_time:
                raise Exception(f"Video generation timed out after {max_wait_time} seconds")
            
            print(f"🎬 Waiting for Gemini Veo video generation to complete... ({elapsed_time:.1f}s)")
            await asyncio.sleep(10)  # Wait 10 seconds before checking again
            
            try:
                operation = client.operations.get(operation)
            except Exception as e:
                print(f"🎬 Error polling operation: {str(e)}")
                await asyncio.sleep(5)  # Wait a bit longer on error
                continue
        
        return operation

    async def _download_video(self, client, generated_video) -> str:
        """Download generated video to temporary file"""
        try:
            # Create temporary file for video
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
            temp_file_path = temp_file.name
            temp_file.close()

            # Download video using the client
            client.files.download(file=generated_video.video)
            generated_video.video.save(temp_file_path)

            print(f'🎬 Gemini Veo video downloaded to: {temp_file_path}')
            return temp_file_path

        except Exception as e:
            print(f'🎬 Error downloading video: {str(e)}')
            raise e

    async def _upload_video_to_r2(self, temp_file_path: str, user_id: str = None) -> Tuple[str, str]:
        """Upload video file to R2 storage (same as inference.py)"""
        try:
            import boto3
            from botocore.config import Config

            # R2配置信息 (same as inference.py)
            R2_CONFIG = {
                'ACCOUNT_ID': '1371dfcb9cd1aabe7f33f392867dcbc7',
                'ACCESS_KEY_ID': '0bcd9cd1c1725283f242688df0d63792',
                'SECRET_ACCESS_KEY': '9dded5c41a0cb18c456aa51156e39b52b529a086ee6ad7f5b8822b0e0e230299',
                'BUCKET_NAME': 'gen-video-task',
                'PUBLIC_URL': 'https://gen-video-buk.reelmind.ai'
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
            task_id = generate_video_id()

            # Create file key path (similar to inference.py but for videos)
            if user_id:
                file_key = f"gen_video_task/user_{user_id}/gemini_veo_{task_id}.mp4"
            else:
                file_key = f"gen_video_task/gemini_veo_{task_id}.mp4"

            print(f'🎬 Uploading video to R2: {file_key}')

            # Upload file to R2
            with open(temp_file_path, 'rb') as file:
                r2_client.upload_fileobj(
                    file,
                    R2_CONFIG['BUCKET_NAME'],
                    file_key,
                    ExtraArgs={
                        'ContentType': 'video/mp4',
                        'ACL': 'public-read'
                    }
                )

            # Generate public URL
            if user_id:
                public_url = f"{R2_CONFIG['PUBLIC_URL']}/gen_video_task/user_{user_id}/gemini_veo_{task_id}.mp4"
            else:
                public_url = f"{R2_CONFIG['PUBLIC_URL']}/gen_video_task/gemini_veo_{task_id}.mp4"

            print(f'🎬 Video uploaded successfully to R2: {public_url}')
            return 'video/mp4', public_url

        except Exception as e:
            print(f'🎬 Video upload to R2 failed: {str(e)}')
            raise e

    async def generate(
        self,
        prompt: str,
        input_image_url: str = None,
        **kwargs
    ) -> Tuple[str, str]:
        """
        Generate video using Gemini Veo 3.0 API

        Args:
            prompt: Text prompt for video generation
            input_image_url: URL of the input image (optional for Veo 3.0)
            duration: Video duration in seconds (optional)
            aspect_ratio: Video aspect ratio (optional)
            **kwargs: Additional parameters

        Returns:
            Tuple of (mime_type, public_url)
        """
        try:
            print(f'🎬 Gemini Veo video generation request:')
            print(f'   Prompt: {prompt[:100]}...' if len(prompt) > 100 else f'   Prompt: {prompt}')

            # Veo 3.0 only supports text-to-video generation
            if input_image_url:
                print(f'   ⚠️  Input image provided but IGNORED: {input_image_url}')
                print(f'   ℹ️  Veo 3.0 only supports text-to-video generation')
            print(f'   Mode: Text-to-video generation')

            # Create Gemini client
            client, types = await self._create_genai_client()
            
            # Prepare generation request (Veo 3.0 API format)
            # Note: Veo 3.0 only supports text-to-video generation
            # input_image_url is always ignored

            # Start video generation (text-to-video only)
            print(f'🎬 Starting Gemini Veo text-to-video generation...')
            operation = client.models.generate_videos(
                model=self.model_name,
                prompt=prompt
            )
            
            print(f'🎬 Video generation operation started: {operation.name}')
            
            # Poll operation until completion
            operation = await self._poll_operation(client, operation)
            
            if not operation.response or not operation.response.generated_videos:
                raise Exception("No video generated in response")
            
            # Get the generated video
            generated_video = operation.response.generated_videos[0]
            print(f'🎬 Video generation completed successfully')
            
            # Download video to temporary file
            temp_file_path = await self._download_video(client, generated_video)

            # Upload to R2 storage directly from local file
            user_id = kwargs.get('user_id', None)
            mime_type, public_url = await self._upload_video_to_r2(temp_file_path, user_id)

            # Clean up temporary file
            try:
                os.unlink(temp_file_path)
            except:
                pass
            
            print(f'🎬 Gemini Veo video generation completed: {public_url}')
            return mime_type, public_url

        except Exception as e:
            print(f'🎬 Gemini Veo video generation error: {str(e)}')
            traceback.print_exc()
            raise e
