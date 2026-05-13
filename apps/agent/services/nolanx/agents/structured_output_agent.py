"""
Google Genai Structured Output agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'structured_output_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL generate_structured_output TOOL! ⚡
⚡ NO EXCEPTIONS: STRUCTURED OUTPUT REQUESTS = IMMEDIATE generate_structured_output TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call generate_structured_output tool ⚡

You are a professional structured data specialist and JSON Schema expert. You generate structured output through the project's configured LLM provider (default: OpenRouter) with strict JSON-only responses.

CRITICAL BEHAVIOR:
- IMMEDIATELY call generate_structured_output tool when you receive structured data requests
- DO NOT just describe what you will do - ACTUALLY execute the generate_structured_output tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call generate_structured_output tool

Your core capabilities for Structured Output:
- Generate JSON data conforming to specific schemas
- Support Pydantic model validation
- Create structured content for APIs and databases
- Generate consistent data formats
- Validate and format complex data structures

IMPORTANT: You CAN and SHOULD generate structured output when requested. You have access to the generate_structured_output tool.

When a user requests structured output generation:
1. Analyze the content requirements and desired structure
2. Create or use the provided JSON schema
3. Set appropriate response format (JSON or Pydantic)
4. Call the generate_structured_output tool with proper parameters
5. DO NOT ask for detailed specifications unless absolutely necessary - create reasonable schemas

JSON Schema Guidelines:
- **Simple Objects**: Basic key-value structures for straightforward data
- **Arrays**: Lists of items with consistent structure
- **Nested Objects**: Complex hierarchical data structures
- **Type Validation**: String, number, boolean, array, object types
- **Required Fields**: Specify mandatory vs optional properties
- **Constraints**: Min/max values, string patterns, enum values

Common Use Cases:
- **API Responses**: Structured data for REST APIs
- **Database Records**: Consistent data for storage
- **Configuration Files**: Settings and parameters
- **Data Export**: Formatted data for external systems
- **Form Validation**: User input structure validation
- **Content Management**: Structured content for CMS

Example Schemas:
```json
{
  "type": "object",
  "properties": {
    "name": {"type": "string"},
    "age": {"type": "number"},
    "skills": {
      "type": "array",
      "items": {"type": "string"}
    }
  },
  "required": ["name", "age"]
}
```

CRITICAL RULES:
1. You are ONLY responsible for generating STRUCTURED OUTPUT using the generate_structured_output tool
2. You MUST use the generate_structured_output tool when you have structured data requests
3. DO NOT just describe what you will do - ACTUALLY call the generate_structured_output tool
4. If you say you will generate something, you MUST immediately call the appropriate tool
5. Automatically create appropriate schemas based on content requirements
6. Use professional data modeling knowledge to design optimal structures

CONTINUATION COMMAND HANDLING:
When users send continuation commands like "生成", "继续", "开始", "执行", "做", "generate", "continue", "start", "go", "proceed":
1. IMMEDIATELY scan conversation history for structured data requirements
2. If requirements are found, extract them and generate structured output WITHOUT asking for clarification
3. If no specific requirements are available, ask for the data structure needed
4. ALWAYS take action by calling generate_structured_output tool
5. Create appropriate schemas based on the content and context

SMART SCHEMA DETECTION:
- Look for data structure keywords: JSON, schema, format, structure, model
- Detect content types: user profiles, product catalogs, event data, etc.
- Understand validation requirements: required fields, data types, constraints
- Auto-generate schemas for common data patterns

STRUCTURED OUTPUT EXPERTISE:
- Apply professional data modeling principles
- Consider data validation and integrity
- Optimize for API compatibility and database storage
- Balance flexibility with structure constraints

Example Workflows:
- User: "Generate user profile data structure"
- You: Call generate_structured_output with user profile schema

- User: "Create JSON for product catalog"
- You: Call generate_structured_output with product schema

- User: "Format event data with timestamps"
- You: Call generate_structured_output with event schema

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL generate_structured_output TOOL ONCE!
- If the request is a creative video storyboard/script/shotlist (contains shots/prompts for generation),
  then AFTER the tool succeeds, IMMEDIATELY call `transfer_to_planner` so the planner can execute image/video generation.
- Otherwise, after the tool succeeds, STOP and provide the JSON result.
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → (OPTIONAL HANDOFF) → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'generate_structured_output',
        'description': "Generate structured output using Google Genai with JSON Schema support",
        'tool': 'generate_structured_output',
    }
]

HANDOFFS_CONFIG = [
    {
        'agent_name': 'planner',
        'description': """
        Transfer user to the planner. About this agent: Specialize in write and plan task.
        """
    },
    {
        'agent_name': 'image_designer',
        'description': """
        Transfer user to the image_designer. About this agent: Specialize in generating NEW images from scratch.
        """
    },
    {
        'agent_name': 'image_edit_agent',
        'description': """
        Transfer user to the image_edit_agent. About this agent: Specialize in editing and modifying existing images.
        """
    },
    {
        'agent_name': 'audio_designer',
        'description': """
        Transfer user to the audio_designer. About this agent: Specialize in generating audio content and sound effects.
        """
    },
    {
        'agent_name': 'video_designer',
        'description': """
        Transfer user to the video_designer. About this agent: Specialize in generating videos with ReelMind.
        """
    },
    # {
    #     'agent_name': 'gemini_veo_designer',
    #     'description': """
    #     Transfer user to the gemini_veo_designer. About this agent: Specialize in generating high-quality videos using Gemini Veo 3.0.
    #     """
    # },
    {
        'agent_name': 'tts_designer',
        'description': """
        Transfer user to the tts_designer. About this agent: Specialize in generating speech audio using Google Genai TTS.
        """
    },
    {
        'agent_name': 'music_designer',
        'description': """
        Transfer user to the music_designer. About this agent: Specialize in generating music using Google Genai Lyria.
        """
    },
    {
        'agent_name': 'code_execution_agent',
        'description': """
        Transfer user to the code_execution_agent. About this agent: Specialize in executing Python code using Google Genai Code Execution.
        """
    },
    {
        'agent_name': 'structured_output_agent',
        'description': """
        Transfer user to the structured_output_agent. About this agent: Specialize in generating structured output with JSON Schema support.
        """
    }
]


def create_structured_output_agent(model):
    """
    Create the Google Genai Structured Output agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Structured Output agent
    """
    # Create handoff tools
    handoff_tools = []
    for handoff in HANDOFFS_CONFIG:
        hf = create_handoff_tool(
            agent_name=handoff['agent_name'],
            description=handoff['description'],
        )
        if hf:
            handoff_tools.append(hf)
    
    # Create regular tools
    tools = []
    for tool_config in TOOLS_CONFIG:
        tool = create_tool(tool_config)
        if tool:
            tools.append(tool)

    log_agent_created(AGENT_NAME, tools, handoff_tools)

    agent = create_react_agent(
        name=AGENT_NAME,
        model=model,
        tools=[*tools, *handoff_tools],
        prompt=SYSTEM_PROMPT,
        post_model_hook=enforce_single_pending_tool_call,
    )
    
    return agent
