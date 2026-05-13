"""
Google Genai Media Analysis tools for LangGraph agents.
Supports image, video, and audio analysis.
"""

import os
import time
import tempfile
from typing import Optional, Annotated, List
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


class AnalyzeMediaInputSchema(BaseModel):
    media_urls: List[str] = Field(description="List of media URLs to analyze (images, videos, audio)")
    analysis_prompt: str = Field(description="What you want to analyze about the media")
    media_type: Optional[str] = Field(
        default="auto",
        description="Media type: 'image', 'video', 'audio', or 'auto' for automatic detection"
    )
    comparison_mode: Optional[bool] = Field(
        default=False,
        description="Whether to compare multiple media files (true) or analyze individually (false)"
    )
    tool_call_id: str


@tool(args_schema=AnalyzeMediaInputSchema)
async def analyze_media(
    media_urls: List[str],
    analysis_prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    media_type: Optional[str] = "auto",
    comparison_mode: Optional[bool] = False,
) -> str:
    """
    Analyze media files (images, videos, audio) using Google Genai.
    
    Args:
        media_urls: List of media URLs to analyze
        analysis_prompt: What to analyze about the media
        media_type: Media type or 'auto' for detection
        comparison_mode: Whether to compare multiple files
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with analysis results
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'🎬 Media analysis request:')
        print(f'   Media files: {len(media_urls)} files')
        print(f'   URLs: {media_urls}')
        print(f'   Analysis: {analysis_prompt}')
        print(f'   Type: {media_type}')
        print(f'   Comparison mode: {comparison_mode}')

        # Analyze media with Genai
        analysis_result = await analyze_media_with_genai(
            media_urls, analysis_prompt, media_type, comparison_mode
        )
        
        print(f'🎬 Media analysis completed successfully')

        # No canvas data generated for analysis tools

        # Create success message (no canvas data or WebSocket updates)
        mode_text = "comparison" if comparison_mode else "individual analysis"
        detected_types = ", ".join(analysis_result.get('detected_types', []))
        success_message = f"🎬 Media analysis completed successfully - Provider: Google Genai ({len(media_urls)} files, {mode_text}, types: {detected_types})"
        success_message += f"\n\n**Analysis Result:**\n{analysis_result['result']}"

        return success_message

    except Exception as e:
        error_message = f"❌ Media analysis failed: {str(e)}"
        print(error_message)
        return error_message


async def analyze_media_with_genai(
    media_urls: List[str], 
    analysis_prompt: str, 
    media_type: str,
    comparison_mode: bool
) -> dict:
    """Analyze media using Google Genai"""
    try:
        from google import genai
        from google.genai import types
        import requests
        
        # Get API key from config
        google_genai_config = config_service.get_service_config('google_genai')
        api_key = google_genai_config.get('api_key')

        if not api_key:
            raise ValueError("Google Genai API key not found in configuration")
        
        # Configure proxy support for genai client
        http_options = await get_genai_http_options()
        
        # Create client with proxy support
        client = genai.Client(api_key=api_key, http_options=http_options)
        
        # Process media files
        media_parts = []
        detected_types = []
        
        for url in media_urls:
            try:
                # Detect media type if auto
                if media_type == "auto":
                    detected_type = detect_media_type(url)
                else:
                    detected_type = media_type
                
                detected_types.append(detected_type)
                
                if detected_type == "image":
                    # Handle image
                    image_bytes = requests.get(url).content
                    image_part = types.Part.from_bytes(
                        data=image_bytes, 
                        mime_type=get_mime_type(url, "image")
                    )
                    media_parts.append(image_part)
                    print(f'🎬 Processed image: {url}')
                    
                elif detected_type == "video":
                    # Handle video (upload to Genai)
                    video_file = client.files.upload(file=url)
                    media_parts.append(video_file)
                    print(f'🎬 Uploaded video: {url}')
                    
                elif detected_type == "audio":
                    # Handle audio
                    audio_bytes = requests.get(url).content
                    audio_part = types.Part.from_bytes(
                        data=audio_bytes,
                        mime_type=get_mime_type(url, "audio")
                    )
                    media_parts.append(audio_part)
                    print(f'🎬 Processed audio: {url}')
                    
            except Exception as e:
                print(f'🎬 Failed to process media {url}: {str(e)}')
                continue
        
        if not media_parts:
            raise Exception("No media files could be processed successfully")
        
        # Prepare analysis prompt
        if comparison_mode and len(media_parts) > 1:
            prompt = f"Compare and analyze these media files: {analysis_prompt}"
        else:
            prompt = f"Analyze this media: {analysis_prompt}"
        
        # Generate analysis
        contents = media_parts + [prompt]
        response = client.models.generate_content(
            model="google/gemini-3-pro-preview",
            contents=contents
        )
        
        analysis_result = response.text
        
        # Encode result for data URL
        import base64
        encoded_result = base64.b64encode(analysis_result.encode('utf-8')).decode('utf-8')
        
        return {
            'result': analysis_result,
            'encoded_result': encoded_result,
            'processed_count': len(media_parts),
            'detected_types': list(set(detected_types))
        }
        
    except Exception as e:
        print(f'🎬 Media analysis error: {str(e)}')
        raise e


def detect_media_type(url: str) -> str:
    """Detect media type from URL extension"""
    url_lower = url.lower()
    
    # Image extensions
    if any(url_lower.endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']):
        return "image"
    
    # Video extensions
    if any(url_lower.endswith(ext) for ext in ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv']):
        return "video"
    
    # Audio extensions
    if any(url_lower.endswith(ext) for ext in ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a']):
        return "audio"
    
    # Default to image if unknown
    return "image"


def get_mime_type(url: str, media_type: str) -> str:
    """Get MIME type from URL extension"""
    url_lower = url.lower()
    
    if media_type == "image":
        if url_lower.endswith('.jpg') or url_lower.endswith('.jpeg'):
            return 'image/jpeg'
        elif url_lower.endswith('.png'):
            return 'image/png'
        elif url_lower.endswith('.gif'):
            return 'image/gif'
        elif url_lower.endswith('.webp'):
            return 'image/webp'
        else:
            return 'image/jpeg'  # Default
    
    elif media_type == "audio":
        if url_lower.endswith('.mp3'):
            return 'audio/mp3'
        elif url_lower.endswith('.wav'):
            return 'audio/wav'
        elif url_lower.endswith('.flac'):
            return 'audio/flac'
        elif url_lower.endswith('.aac'):
            return 'audio/aac'
        else:
            return 'audio/mp3'  # Default
    
    return 'application/octet-stream'


async def get_genai_http_options() -> dict:
    """Get HTTP options for genai client with proxy support"""
    try:
        # Check for proxy environment variables
        proxy_url = None
        
        # Check environment variables (same as start_with_proxy.sh)
        for env_var in ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']:
            proxy_url = os.getenv(env_var)
            if proxy_url:
                print(f'🎬 Using proxy from {env_var}: {proxy_url}')
                break
        
        if proxy_url:
            # Configure HTTP options with proxy
            return {
                'proxies': {
                    'http': proxy_url,
                    'https': proxy_url,
                }
            }
        else:
            print('🎬 No proxy configuration found, using direct connection')
            return {}
            
    except Exception as e:
        print(f'🎬 Error configuring proxy: {str(e)}')
        return {}



