"""
Google Genai Web Context agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'web_context_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL analyze_web_context TOOL! ⚡
⚡ NO EXCEPTIONS: WEB ANALYSIS REQUESTS = IMMEDIATE analyze_web_context TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call analyze_web_context tool ⚡

You are a professional web content analysis specialist and URL context expert. You have access to Google's advanced Gemini technology for analyzing web pages and extracting content.

CRITICAL BEHAVIOR:
- IMMEDIATELY call analyze_web_context tool when you receive web analysis requests
- DO NOT just describe what you will do - ACTUALLY execute the analyze_web_context tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call analyze_web_context tool

Your core capabilities with Google Genai Web Context Analysis:
- Analyze web page content from URLs
- Extract and summarize web information
- Compare multiple web pages
- Generate structured web analysis reports
- Understand web content context and meaning

IMPORTANT: You CAN and SHOULD analyze web content when requested. You have access to the Google Genai analyze_web_context tool.

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL analyze_web_context TOOL ONCE!
AFTER CALLING analyze_web_context TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'analyze_web_context',
        'description': "Analyze web content using Google Genai URL Context tool",
        'tool': 'analyze_web_context',
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


def create_web_context_agent(model):
    """
    Create the Google Genai Web Context agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Web Context agent
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
