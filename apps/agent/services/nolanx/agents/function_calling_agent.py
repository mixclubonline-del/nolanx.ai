"""
Google Genai Function Calling agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'function_calling_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL execute_function_call TOOL! ⚡
⚡ NO EXCEPTIONS: FUNCTION CALLING REQUESTS = IMMEDIATE execute_function_call TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call execute_function_call tool ⚡

You are a professional function calling specialist and API integration expert. You have access to Google's advanced Gemini technology for function calling and tool integration.

CRITICAL BEHAVIOR:
- IMMEDIATELY call execute_function_call tool when you receive function calling requests
- DO NOT just describe what you will do - ACTUALLY execute the execute_function_call tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call execute_function_call tool

Your core capabilities with Google Genai Function Calling:
- Execute function calls with proper parameters
- Validate function signatures and arguments
- Handle function responses and errors
- Support complex function workflows
- Integrate with external APIs and tools
- Inspect NolanX skills and MCP providers when the workflow depends on external capabilities
- Read or update frozen memory snapshots when durable user/workflow memory is relevant

IMPORTANT: You CAN and SHOULD execute function calls when requested. You have access to the Google Genai execute_function_call tool.

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL execute_function_call TOOL ONCE!
AFTER CALLING execute_function_call TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'execute_function_call',
        'description': "Execute function calling using Google Genai",
        'tool': 'execute_function_call',
    },
    {
        'name': 'list_skills',
        'description': "List NolanX, OpenClaw, and Hermes skills available to the function agent",
        'tool': 'list_skills',
    },
    {
        'name': 'activate_skill',
        'description': "Load a skill's SKILL.md instructions into the current function-calling context",
        'tool': 'activate_skill',
    },
    {
        'name': 'install_local_skill',
        'description': "Install a local SKILL.md file or skill directory into NolanX managed skill imports",
        'tool': 'install_local_skill',
    },
    {
        'name': 'list_mcp_servers',
        'description': "List configured MCP servers available through NolanX",
        'tool': 'list_mcp_servers',
    },
    {
        'name': 'call_mcp_tool',
        'description': "Call a configured MCP tool through NolanX's provider router",
        'tool': 'call_mcp_tool',
    },
    {
        'name': 'list_memory_providers',
        'description': "List configured NolanX memory providers",
        'tool': 'list_memory_providers',
    },
    {
        'name': 'get_memory_snapshot',
        'description': "Read the current frozen memory snapshot for a user/session",
        'tool': 'get_memory_snapshot',
    },
    {
        'name': 'mutate_memory',
        'description': "Persist durable memory notes using add/replace/remove/status actions",
        'tool': 'mutate_memory',
    },
    {
        'name': 'list_model_providers',
        'description': "List provider-router preferences and custom providers for the current NolanX runtime",
        'tool': 'list_model_providers',
    },
    {
        'name': 'list_acp_bridges',
        'description': "List ACP bridges for OpenClaw/Hermes compatible remote runtimes",
        'tool': 'list_acp_bridges',
    },
    {
        'name': 'invoke_acp_bridge',
        'description': "Invoke a configured ACP bridge gateway/runtime adapter",
        'tool': 'invoke_acp_bridge',
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


def create_function_calling_agent(model):
    """
    Create the Google Genai Function Calling agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Function Calling agent
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
