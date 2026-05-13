from abc import ABC, abstractmethod
from typing import Optional, Tuple
import uuid
import tempfile
import aiohttp
from utils.http_client import HttpClient
from services.config_service import config_service


class VideoGenerator(ABC):
    """Abstract base class for video generators"""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        input_image_url: Optional[str] = None,
        image_urls: Optional[list[str]] = None,
        video_urls: Optional[list[str]] = None,
        audio_urls: Optional[list[str]] = None,
        first_frame_url: Optional[str] = None,
        last_frame_url: Optional[str] = None,
        duration: Optional[int] = None,
        aspect_ratio: Optional[str] = None,
        **kwargs
    ) -> Tuple[str, str]:
        """
        Generate a video and return metadata

        Args:
            prompt: Text prompt for video generation
            input_image_url: Legacy primary image URL for image-to-video generation
            image_urls: Multi-reference image URLs used by reference-to-video models
            video_urls: Reference video URLs used by video-to-video models
            audio_urls: Reference audio URLs used by multimodal video models
            first_frame_url: First frame URL for transition / first-last-frame generation
            last_frame_url: Last frame URL for transition / first-last-frame generation
            duration: Video duration in seconds (optional)
            aspect_ratio: Video aspect ratio (optional)
            **kwargs: Additional provider-specific parameters

        Returns:
            Tuple of (mime_type, public_url)
        """
        pass


def generate_video_id():
    """Generate unique video ID using UUID format"""
    return str(uuid.uuid4())


async def get_video_info_and_save(url: str, filename: str = None) -> Tuple[str, str]:
    """
    Download video from URL and upload to reelmind.server
    
    Args:
        url: Video URL to download
        filename: Optional filename
        
    Returns:
        Tuple of (mime_type, public_url)
    """
    try:
        # Download video content
        async with HttpClient.create() as client:
            response = await client.get(url)
            video_content = response.content
            
        # Determine MIME type from response headers or URL
        content_type = response.headers.get('content-type', 'video/mp4')
        mime_type = content_type.split(';')[0]  # Remove any additional parameters
        
        # Map MIME types to file extensions
        extension_map = {
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/avi': '.avi',
            'video/mov': '.mov',
            'video/quicktime': '.mov',
        }
        
        file_extension = extension_map.get(mime_type, '.mp4')
        
        # Generate filename if not provided
        if not filename:
            filename = f"{generate_video_id()}{file_extension}"
        elif not filename.endswith(file_extension):
            filename = f"{filename}{file_extension}"
            
        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as temp_file:
            temp_file.write(video_content)
            temp_file_path = temp_file.name
            
        print(f'🎬 Video saved to temporary file: {temp_file_path}')
        
        # Call reelmind.server API to upload from local file
        payload = {
            "filePath": temp_file_path,
            "deleteAfterUpload": True,  # Let server delete the temp file
            "filename": filename
        }

        # Get reelmind.server URL from config
        server_url = config_service.get_reelmind_server_url()
        upload_url = f"{server_url}/files/upload-from-local"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                upload_url,
                json=payload
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    public_url = result.get('url')
                    if public_url:
                        print(f'🎬 Video uploaded successfully: {public_url}')
                        return mime_type, public_url
                    else:
                        raise Exception("No URL returned from upload service")
                else:
                    error_text = await response.text()
                    raise Exception(f"Upload failed with status {response.status}: {error_text}")
                    
    except Exception as e:
        print(f"Error in get_video_info_and_save: {str(e)}")
        raise e
