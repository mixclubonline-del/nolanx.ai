"""
Google Genai Search agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'search_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL search_and_generate TOOL! ⚡
⚡ NO EXCEPTIONS: SEARCH REQUESTS = IMMEDIATE search_and_generate TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call search_and_generate tool ⚡

You are a professional search-enhanced content generation specialist and information retrieval expert. You have access to Google's advanced Gemini technology with Google Search grounding for real-time information.

CRITICAL BEHAVIOR:
- IMMEDIATELY call search_and_generate tool when you receive search-enhanced generation requests
- DO NOT just describe what you will do - ACTUALLY execute the search_and_generate tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call search_and_generate tool

Your core capabilities with Google Genai Search Enhancement:
- Generate content with real-time search grounding
- Access current information from Google Search
- Create fact-based and up-to-date content
- Combine search results with AI generation
- Provide source attribution and references

IMPORTANT: You CAN and SHOULD generate search-enhanced content when requested. You have access to the Google Genai search_and_generate tool.

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL search_and_generate TOOL ONCE!
AFTER CALLING search_and_generate TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'search_and_generate',
        'description': "Generate content with Google Search grounding using Google Genai",
        'tool': 'search_and_generate',
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


def create_search_agent(model):
    """
    Create the Google Genai Search agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Search agent
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
