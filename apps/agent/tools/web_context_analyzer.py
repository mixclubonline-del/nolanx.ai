"""
Google Genai Web Context Analysis tools for LangGraph agents.
"""

import os
import time
from typing import Optional, Annotated, List
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


class AnalyzeWebContextInputSchema(BaseModel):
    urls: List[str] = Field(description="List of URLs to analyze")
    analysis_prompt: str = Field(description="What you want to analyze about the web content")
    comparison_mode: Optional[bool] = Field(
        default=False,
        description="Whether to compare multiple URLs (true) or analyze individually (false)"
    )
    tool_call_id: str


@tool(args_schema=AnalyzeWebContextInputSchema)
async def analyze_web_context(
    urls: List[str],
    analysis_prompt: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    comparison_mode: Optional[bool] = False,
) -> str:
    """
    Analyze web content using Google Genai URL Context tool.
    
    Args:
        urls: List of URLs to analyze
        analysis_prompt: What to analyze about the web content
        comparison_mode: Whether to compare multiple URLs
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with web analysis results
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'🌐 Web context analysis request:')
        print(f'   URLs: {len(urls)} pages')
        print(f'   URLs: {urls}')
        print(f'   Analysis: {analysis_prompt}')
        print(f'   Comparison mode: {comparison_mode}')

        # Analyze web content with Genai
        analysis_result = await analyze_web_with_genai(
            urls, analysis_prompt, comparison_mode
        )
        
        print(f'🌐 Web context analysis completed successfully')

        # Create file data for analysis results
        file_id = generate()
        file_data = {
            'mimeType': 'text/markdown',
            'id': file_id,
            'dataURL': f'data:text/markdown;base64,{analysis_result["encoded_result"]}',
            'created': int(time.time() * 1000),
            'contentType': 'web_context_analysis',
            'provider': 'google_genai',
            'model': 'google/gemini-3-pro-preview',
            'urls': urls,
            'analysisPrompt': analysis_prompt,
            'comparisonMode': comparison_mode,
            'analysisResult': analysis_result['result'],
            'urlCount': len(urls),
            'urlMetadata': analysis_result.get('url_metadata', []),
        }

        # Create success message (no canvas data generated)
        mode_text = "comparison" if comparison_mode else "individual analysis"
        success_message = f"🌐 Web context analysis completed successfully - Provider: Google Genai ({len(urls)} URLs, {mode_text})"
        success_message += f"\n\n**Analysis Result:**\n{analysis_result['result']}"

        return success_message

    except Exception as e:
        error_message = f"❌ Web context analysis failed: {str(e)}"
        print(error_message)
        return error_message


async def analyze_web_with_genai(
    urls: List[str], 
    analysis_prompt: str, 
    comparison_mode: bool
) -> dict:
    """Analyze web content using Google Genai URL Context"""
    try:
        from google import genai
        from google.genai.types import Tool, GenerateContentConfig, UrlContext
        
        # Get API key from config
        google_genai_config = config_service.get_service_config('google_genai')
        api_key = google_genai_config.get('api_key')

        if not api_key:
            raise ValueError("Google Genai API key not found in configuration")
        
        # Configure proxy support for genai client
        http_options = await get_genai_http_options()
        
        # Create client with proxy support
        client = genai.Client(api_key=api_key, http_options=http_options)
        
        # Configure URL context tool
        url_context_tool = Tool(url_context=UrlContext)
        
        # Prepare analysis prompt with URLs
        if comparison_mode and len(urls) > 1:
            url_list = " and ".join(urls)
            prompt = f"Compare and analyze content from {url_list}: {analysis_prompt}"
        else:
            url_list = ", ".join(urls)
            prompt = f"Analyze content from {url_list}: {analysis_prompt}"
        
        # Generate analysis with URL context
        response = client.models.generate_content(
            model="google/gemini-3-pro-preview",
            contents=prompt,
            config=GenerateContentConfig(
                tools=[url_context_tool],
                response_modalities=["TEXT"],
            )
        )
        
        # Extract analysis result
        analysis_result = ""
        for part in response.candidates[0].content.parts:
            if part.text:
                analysis_result += part.text
        
        # Get URL metadata if available
        url_metadata = []
        if hasattr(response.candidates[0], 'url_context_metadata') and response.candidates[0].url_context_metadata:
            url_metadata = response.candidates[0].url_context_metadata
            print(f'🌐 Retrieved URL metadata: {len(url_metadata)} entries')
        
        # Encode result for data URL
        import base64
        encoded_result = base64.b64encode(analysis_result.encode('utf-8')).decode('utf-8')
        
        return {
            'result': analysis_result,
            'encoded_result': encoded_result,
            'url_metadata': url_metadata,
            'analyzed_count': len(urls)
        }
        
    except Exception as e:
        print(f'🌐 Web context analysis error: {str(e)}')
        raise e


async def get_genai_http_options() -> dict:
    """Get HTTP options for genai client with proxy support"""
    try:
        # Check for proxy environment variables
        proxy_url = None
        
        # Check environment variables (same as start_with_proxy.sh)
        for env_var in ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']:
            proxy_url = os.getenv(env_var)
            if proxy_url:
                print(f'🌐 Using proxy from {env_var}: {proxy_url}')
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
            print('🌐 No proxy configuration found, using direct connection')
            return {}
            
    except Exception as e:
        print(f'🌐 Error configuring proxy: {str(e)}')
        return {}


async def generate_new_web_element(canvas_id: str, file_id: str, web_data: dict):
    """Generate a new web context analysis element for the canvas"""
    canvas = await api_client_service.get_canvas_data(canvas_id)
    if canvas is None:
        canvas = {'data': {}}
    canvas_data = canvas.get('data', {})
    if canvas_data is None:
        canvas_data = {}
    elements = canvas_data.get('elements', [])

    # Find the last text element or any element to position the new one
    last_x = 0
    last_y = 0
    last_width = 0
    last_height = 0

    for element in elements:
        if element.get('type') in ['text', 'web']:
            last_x = element.get('x', 0)
            last_y = element.get('y', 0)
            last_width = element.get('width', 600)
            last_height = element.get('height', 400)
        elif element.get('type') in ['video', 'image', 'audio']:
            last_x = element.get('x', 0)
            last_y = element.get('y', 0)
            last_width = element.get('width', 600)
            last_height = element.get('height', 400)

    # Calculate new position (offset from last element)
    new_x = last_x + last_width + 20 if last_width > 0 else 100
    new_y = last_y if last_y > 0 else 100

    # Default web analysis dimensions
    width = 600
    height = 400

    new_web_element = {
        'type': 'text',  # Use text type for web analysis display
        'id': generate(),
        'x': new_x,
        'y': new_y,
        'width': width,
        'height': height,
        'fileId': file_id,
        'text': web_data.get('analysisResult', ''),
        'provider': 'google_genai',
        'model': 'google/gemini-3-pro-preview',
        'contentType': 'web_context_analysis',
        'urls': web_data.get('urls', []),
        'analysisPrompt': web_data.get('analysisPrompt'),
        'comparisonMode': web_data.get('comparisonMode', False),
        'urlCount': web_data.get('urlCount', 0),
        'urlMetadata': web_data.get('urlMetadata', []),
        'created': web_data.get('created', int(time.time() * 1000)),
        'fontSize': 12,
        'fontFamily': 'Arial, sans-serif',
        'backgroundColor': '#ffffff',
        'textColor': '#333333',
        'borderColor': '#cccccc',
        'borderWidth': 1,
    }

    return new_web_element
