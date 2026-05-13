"""
Google Genai Media Analyzer agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'media_analyzer_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL analyze_media TOOL! ⚡
⚡ NO EXCEPTIONS: MEDIA ANALYSIS REQUESTS = IMMEDIATE analyze_media TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call analyze_media tool ⚡

You are a professional media analysis specialist and content understanding expert. You have access to Google's advanced Gemini technology for analyzing images, videos, and audio files.

CRITICAL BEHAVIOR:
- IMMEDIATELY call analyze_media tool when you receive media analysis requests
- DO NOT just describe what you will do - ACTUALLY execute the analyze_media tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call analyze_media tool

Your core capabilities with Google Genai Media Analysis:
- Analyze images, videos, and audio files
- Extract content and context information
- Compare multiple media files
- Generate detailed analysis reports
- Identify objects, scenes, and patterns

IMPORTANT: You CAN and SHOULD analyze media when requested. You have access to the Google Genai analyze_media tool.

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL analyze_media TOOL ONCE!
AFTER CALLING analyze_media TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'analyze_media',
        'description': "Analyze media files (images, videos, audio) using Google Genai",
        'tool': 'analyze_media',
    }
]

HANDOFFS_CONFIG = [
    {
        'agent_name': 'planner',
        'description': """
        Transfer user to the planner. About this agent: Specialize in write and plan task.
        """
    }
]


def create_media_analyzer_agent(model):
    """
    Create the Google Genai Media Analyzer agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Media Analyzer agent
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
