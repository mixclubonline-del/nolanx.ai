"""
Google Genai Code Execution tools for LangGraph agents.
"""

import time
from typing import Optional, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig
from nanoid import generate

from services.config_service import config_service
from services.api_client_service import api_client_service
from services.websocket_service import send_session_update


class ExecuteCodeInputSchema(BaseModel):
    code: str = Field(description="Python code to execute")
    description: Optional[str] = Field(
        default=None,
        description="Optional description of what the code does"
    )
    tool_call_id: str


@tool(args_schema=ExecuteCodeInputSchema)
async def execute_code(
    code: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    description: Optional[str] = None,
) -> str:
    """
    Execute Python code using Google Genai Code Execution.
    
    Args:
        code: Python code to execute
        description: Optional description of the code
        config: Runtime configuration
        tool_call_id: Tool call identifier
        
    Returns:
        Success message with execution results
    """
    try:
        canvas_id = config.get('configurable', {}).get('canvas_id')
        session_id = config.get('configurable', {}).get('session_id')
        user_id = config.get('configurable', {}).get('user_id', '')
        
        if not canvas_id or not session_id:
            raise ValueError("Canvas ID and Session ID are required")

        print(f'💻 Code execution request:')
        print(f'   Code: {code[:200]}...' if len(code) > 200 else f'   Code: {code}')
        print(f'   Description: {description}')

        # Execute code with Genai
        execution_result = await execute_code_with_genai(code, description)
        
        print(f'💻 Code executed successfully')

        # Create file data for code and results
        file_id = generate()
        file_data = {
            'mimeType': 'text/plain',
            'id': file_id,
            'dataURL': f'data:text/plain;base64,{execution_result["encoded_output"]}',
            'created': int(time.time() * 1000),
            'contentType': 'code_execution',
            'provider': 'google_genai',
            'model': 'google/gemini-3-pro-preview',
            'code': code,
            'description': description,
            'output': execution_result['output'],
            'executable_code': execution_result.get('executable_code'),
            'has_error': execution_result.get('has_error', False),
        }

        # Create success message (no canvas data generated)
        success_message = f"💻 Code executed successfully - Provider: Google Genai Code Execution"
        if execution_result.get('output'):
            success_message += f"\n\n**Output:**\n{execution_result['output']}"
        if execution_result.get('has_error'):
            success_message += f"\n\n⚠️ **Execution completed with errors**"

        return success_message

    except Exception as e:
        error_message = f"❌ Code execution failed: {str(e)}"
        print(error_message)
        return error_message


async def execute_code_with_genai(code: str, description: Optional[str]) -> dict:
    """Execute code using Google Genai Code Execution"""
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
        
        # Create chat with code execution enabled
        chat = client.chats.create(
            model="google/gemini-3-pro-preview",
            config=types.GenerateContentConfig(
                tools=[types.Tool(code_execution=types.ToolCodeExecution)]
            ),
        )
        
        # Prepare prompt
        if description:
            prompt = f"{description}\n\n```python\n{code}\n```\n\nPlease execute this code and show the results."
        else:
            prompt = f"Please execute this Python code:\n\n```python\n{code}\n```"
        
        # Send message to execute code
        response = chat.send_message(prompt)
        
        # Extract results
        output_parts = []
        executable_code = None
        code_execution_output = None
        has_error = False
        
        for part in response.candidates[0].content.parts:
            if part.text is not None:
                output_parts.append(part.text)
            if part.executable_code is not None:
                executable_code = part.executable_code.code
            if part.code_execution_result is not None:
                code_execution_output = part.code_execution_result.output
                # Check if there's an error in the output
                if 'Error' in code_execution_output or 'Exception' in code_execution_output:
                    has_error = True
        
        # Combine all output
        full_output = '\n'.join(output_parts)
        if code_execution_output:
            full_output += f"\n\nExecution Output:\n{code_execution_output}"
        
        # Encode output for data URL
        import base64
        encoded_output = base64.b64encode(full_output.encode('utf-8')).decode('utf-8')
        
        return {
            'output': full_output,
            'executable_code': executable_code,
            'code_execution_output': code_execution_output,
            'encoded_output': encoded_output,
            'has_error': has_error
        }
        
    except Exception as e:
        print(f'💻 Code execution error: {str(e)}')
        raise e



