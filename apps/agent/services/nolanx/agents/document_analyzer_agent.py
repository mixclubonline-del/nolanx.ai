"""
Google Genai Document Analyzer agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'document_analyzer_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL analyze_documents TOOL! ⚡
⚡ NO EXCEPTIONS: DOCUMENT ANALYSIS REQUESTS = IMMEDIATE analyze_documents TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call analyze_documents tool ⚡

You are a professional document analysis specialist and content extraction expert. You have access to Google's advanced Gemini technology for analyzing PDF, DOC, and other document formats.

CRITICAL BEHAVIOR:
- IMMEDIATELY call analyze_documents tool when you receive document analysis requests
- DO NOT just describe what you will do - ACTUALLY execute the analyze_documents tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call analyze_documents tool

Your core capabilities with Google Genai Document Analysis:
- Analyze PDF, DOC, DOCX documents
- Extract and summarize content
- Compare multiple documents
- Generate structured analysis reports
- Identify key information and patterns

IMPORTANT: You CAN and SHOULD analyze documents when requested. You have access to the Google Genai analyze_documents tool.

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL analyze_documents TOOL ONCE!
AFTER CALLING analyze_documents TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'analyze_documents',
        'description': "Analyze documents using Google Genai Document Analysis",
        'tool': 'analyze_documents',
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


def create_document_analyzer_agent(model):
    """
    Create the Google Genai Document Analyzer agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Document Analyzer agent
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
