"""
Google Genai Function Calling tools for LangGraph agents.
"""

import os
import time
import json
from typing import Optional, Annotated, List, Dict, Any
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


class FunctionDeclaration(BaseModel):
    name: str = Field(description="Function name")
    description: str = Field(description="Function description")
    parameters: Dict[str, Any] = Field(description="Function parameters schema")


class ExecuteFunctionCallInputSchema(BaseModel):
    prompt: str = Field(description="User prompt that may trigger function calls")
    function_declarations: List[FunctionDeclaration] = Field(description="Available function declarations")
    auto_execute: Optional[bool] = Field(
        default=False,
        description="Whether to automatically execute the function calls (simulation mode)"
    )
    tool_call_id: str


@tool(args_schema=ExecuteFunctionCallInputSchema)
async def execute_function_call(
    prompt: str,
    function_declarations: List[FunctionDeclaration],
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    auto_execute: Optional[bool] = False,
) -> str:
    """
    Execute function calling using Google Genai.
    
    Args:
        prompt: User prompt that may trigger function calls
        function_declarations: Available function declarations
        auto_execute: Whether to simulate function execution
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with function call results
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'🔧 Function calling request:')
        print(f'   Prompt: {prompt}')
        print(f'   Functions: {len(function_declarations)} available')
        print(f'   Auto execute: {auto_execute}')

        # Execute function calling with Genai
        result = await execute_function_with_genai(
            prompt, function_declarations, auto_execute
        )
        
        print(f'🔧 Function calling completed successfully')

        # Create file data for function call results
        file_id = generate()
        file_data = {
            'mimeType': 'application/json',
            'id': file_id,
            'dataURL': f'data:application/json;base64,{result["encoded_result"]}',
            'created': int(time.time() * 1000),
            'contentType': 'function_call',
            'provider': 'google_genai',
            'model': 'google/gemini-3-pro-preview',
            'prompt': prompt,
            'functionDeclarations': [f.dict() for f in function_declarations],
            'autoExecute': auto_execute,
            'functionCalls': result.get('function_calls', []),
            'responses': result.get('responses', []),
            'hasFunction': result.get('has_function', False),
        }

        # Create success message (no canvas data generated)
        if result.get('has_function'):
            success_message = f"🔧 Function calling completed successfully - Provider: Google Genai ({len(result.get('function_calls', []))} function calls)"
            success_message += f"\n\n**Function Calls:**\n{json.dumps(result.get('function_calls', []), indent=2, ensure_ascii=False)}"
        else:
            success_message = f"🔧 No function calls detected - Provider: Google Genai\n\n**Response:** {result.get('text_response', '')}"

        return success_message

    except Exception as e:
        error_message = f"❌ Function calling failed: {str(e)}"
        print(error_message)
        return error_message


async def execute_function_with_genai(
    prompt: str, 
    function_declarations: List[FunctionDeclaration],
    auto_execute: bool
) -> dict:
    """Execute function calling using Google Genai"""
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
        
        # Convert function declarations to Genai format
        genai_functions = []
        for func_decl in function_declarations:
            genai_function = {
                "name": func_decl.name,
                "description": func_decl.description,
                "parameters": func_decl.parameters,
            }
            genai_functions.append(genai_function)
        
        # Configure tools
        tools = types.Tool(function_declarations=genai_functions)
        config = types.GenerateContentConfig(tools=[tools])
        
        # Send request with function declarations
        response = client.models.generate_content(
            model="google/gemini-3-pro-preview",
            contents=prompt,
            config=config,
        )
        
        # Check for function calls
        function_calls = []
        responses = []
        has_function = False
        text_response = ""
        
        if response.candidates and len(response.candidates) > 0:
            candidate = response.candidates[0]
            
            if candidate.content and candidate.content.parts:
                for part in candidate.content.parts:
                    if part.function_call:
                        has_function = True
                        function_call_info = {
                            "name": part.function_call.name,
                            "arguments": dict(part.function_call.args)
                        }
                        function_calls.append(function_call_info)
                        
                        # Simulate function execution if auto_execute is True
                        if auto_execute:
                            simulated_result = simulate_function_execution(
                                part.function_call.name, 
                                dict(part.function_call.args)
                            )
                            responses.append(simulated_result)
                        
                        print(f'🔧 Function call detected: {part.function_call.name}')
                        print(f'🔧 Arguments: {dict(part.function_call.args)}')
                    
                    elif part.text:
                        text_response += part.text
        
        if not has_function:
            text_response = response.text if response.text else "No function call found in the response."
        
        # Prepare result data
        result_data = {
            'function_calls': function_calls,
            'responses': responses,
            'has_function': has_function,
            'text_response': text_response,
            'prompt': prompt,
            'available_functions': [f.name for f in function_declarations]
        }
        
        # Encode result for data URL
        import base64
        encoded_result = base64.b64encode(
            json.dumps(result_data, ensure_ascii=False).encode('utf-8')
        ).decode('utf-8')
        
        result_data['encoded_result'] = encoded_result
        return result_data
        
    except Exception as e:
        print(f'🔧 Function calling error: {str(e)}')
        raise e


def simulate_function_execution(function_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Simulate function execution for demonstration purposes"""
    return {
        'function_name': function_name,
        'arguments': arguments,
        'result': f"Simulated execution of {function_name} with arguments: {arguments}",
        'status': 'success',
        'timestamp': int(time.time() * 1000)
    }


async def get_genai_http_options() -> dict:
    """Get HTTP options for genai client with proxy support"""
    try:
        # Check for proxy environment variables
        proxy_url = None
        
        # Check environment variables (same as start_with_proxy.sh)
        for env_var in ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']:
            proxy_url = os.getenv(env_var)
            if proxy_url:
                print(f'🔧 Using proxy from {env_var}: {proxy_url}')
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
            print('🔧 No proxy configuration found, using direct connection')
            return {}
            
    except Exception as e:
        print(f'🔧 Error configuring proxy: {str(e)}')
        return {}



