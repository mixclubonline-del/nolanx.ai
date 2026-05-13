"""
Google Genai Search-enhanced generation tools for LangGraph agents.
"""

import os
import time
from typing import Optional, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


class SearchAndGenerateInputSchema(BaseModel):
    query: str = Field(description="Search query and generation prompt")
    search_enhanced: Optional[bool] = Field(
        default=True,
        description="Whether to use Google Search grounding for enhanced results"
    )
    tool_call_id: str


@tool(args_schema=SearchAndGenerateInputSchema)
async def search_and_generate(
    query: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    search_enhanced: Optional[bool] = True,
) -> str:
    """
    Generate content with Google Search grounding using Google Genai.
    
    Args:
        query: Search query and generation prompt
        search_enhanced: Whether to use Google Search grounding
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with search-enhanced content
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'🔍 Search-enhanced generation request:')
        print(f'   Query: {query}')
        print(f'   Search enhanced: {search_enhanced}')

        # Generate content with search grounding
        result = await generate_with_search_grounding(query, search_enhanced)
        
        print(f'🔍 Search-enhanced generation completed successfully')

        # Create file data for search results
        file_id = generate()
        file_data = {
            'mimeType': 'text/markdown',
            'id': file_id,
            'dataURL': f'data:text/markdown;base64,{result["encoded_result"]}',
            'created': int(time.time() * 1000),
            'contentType': 'search_enhanced_content',
            'provider': 'google_genai',
            'model': 'google/gemini-3-pro-preview',
            'query': query,
            'searchEnhanced': search_enhanced,
            'generatedContent': result['content'],
            'searchSources': result.get('search_sources', []),
            'hasSearchResults': result.get('has_search_results', False),
        }

        # Create success message (no canvas data generated)
        enhancement_text = "with Google Search grounding" if search_enhanced else "without search enhancement"
        success_message = f"🔍 Search-enhanced content generated successfully - Provider: Google Genai ({enhancement_text})"
        if result.get('search_sources'):
            success_message += f"\n\n**Sources:** {len(result['search_sources'])} search results used"
        success_message += f"\n\n**Generated Content:**\n{result['content']}"

        return success_message

    except Exception as e:
        error_message = f"❌ Search-enhanced generation failed: {str(e)}"
        print(error_message)
        return error_message


async def generate_with_search_grounding(query: str, search_enhanced: bool) -> dict:
    """Generate content with Google Search grounding using Google Genai"""
    try:
        from google import genai
        from google.genai import types
        
        # Get API key from config
        google_genai_config = config_service.get_service_config('google_genai')
        api_key = google_genai_config.get('api_key')

        if not api_key:
            raise ValueError("Google Genai API key not found in configuration")
        
        # Configure proxy support for genai client
        http_options = await get_genai_http_options()
        
        # Create client with proxy support
        client = genai.Client(api_key=api_key, http_options=http_options)
        
        if search_enhanced:
            # Configure Google Search grounding tool
            grounding_tool = types.Tool(
                google_search=types.GoogleSearch()
            )
            
            # Configure generation settings with search
            config = types.GenerateContentConfig(
                tools=[grounding_tool]
            )
            
            # Make the request with search grounding
            response = client.models.generate_content(
                model="google/gemini-3-pro-preview",
                contents=query,
                config=config,
            )
        else:
            # Generate without search grounding
            response = client.models.generate_content(
                model="google/gemini-3-pro-preview",
                contents=query,
            )
        
        # Extract generated content
        generated_content = response.text
        
        # Extract search sources if available
        search_sources = []
        has_search_results = False
        
        if search_enhanced and hasattr(response, 'grounding_metadata'):
            # Extract grounding metadata if available
            grounding_metadata = response.grounding_metadata
            if grounding_metadata and hasattr(grounding_metadata, 'search_entry_point'):
                has_search_results = True
                # Extract search sources from grounding metadata
                # Note: The exact structure may vary based on the API response
                search_sources = extract_search_sources(grounding_metadata)
        
        # Encode result for data URL
        import base64
        encoded_result = base64.b64encode(generated_content.encode('utf-8')).decode('utf-8')
        
        return {
            'content': generated_content,
            'encoded_result': encoded_result,
            'search_sources': search_sources,
            'has_search_results': has_search_results,
            'query': query
        }
        
    except Exception as e:
        print(f'🔍 Search-enhanced generation error: {str(e)}')
        raise e


def extract_search_sources(grounding_metadata) -> list:
    """Extract search sources from grounding metadata"""
    try:
        sources = []
        
        # This is a placeholder implementation
        # The actual structure depends on the Google Genai API response format
        if hasattr(grounding_metadata, 'grounding_chunks'):
            for chunk in grounding_metadata.grounding_chunks:
                if hasattr(chunk, 'web') and hasattr(chunk.web, 'uri'):
                    sources.append({
                        'url': chunk.web.uri,
                        'title': getattr(chunk.web, 'title', 'Unknown Title')
                    })
        
        return sources
        
    except Exception as e:
        print(f'🔍 Error extracting search sources: {str(e)}')
        return []


async def get_genai_http_options() -> dict:
    """Get HTTP options for genai client with proxy support"""
    try:
        # Check for proxy environment variables
        proxy_url = None
        
        # Check environment variables (same as start_with_proxy.sh)
        for env_var in ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']:
            proxy_url = os.getenv(env_var)
            if proxy_url:
                print(f'🔍 Using proxy from {env_var}: {proxy_url}')
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
            print('🔍 No proxy configuration found, using direct connection')
            return {}
            
    except Exception as e:
        print(f'🔍 Error configuring proxy: {str(e)}')
        return {}


async def generate_new_search_element(canvas_id: str, file_id: str, search_data: dict):
    """Generate a new search-enhanced content element for the canvas"""
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
        if element.get('type') in ['text', 'search']:
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

    # Default search content dimensions
    width = 600
    height = 400

    new_search_element = {
        'type': 'text',  # Use text type for search content display
        'id': generate(),
        'x': new_x,
        'y': new_y,
        'width': width,
        'height': height,
        'fileId': file_id,
        'text': search_data.get('generatedContent', ''),
        'provider': 'google_genai',
        'model': 'google/gemini-3-pro-preview',
        'contentType': 'search_enhanced_content',
        'query': search_data.get('query'),
        'searchEnhanced': search_data.get('searchEnhanced', True),
        'searchSources': search_data.get('searchSources', []),
        'hasSearchResults': search_data.get('hasSearchResults', False),
        'created': search_data.get('created', int(time.time() * 1000)),
        'fontSize': 12,
        'fontFamily': 'Arial, sans-serif',
        'backgroundColor': '#ffffff',
        'textColor': '#333333',
        'borderColor': '#cccccc',
        'borderWidth': 1,
    }

    return new_search_element
