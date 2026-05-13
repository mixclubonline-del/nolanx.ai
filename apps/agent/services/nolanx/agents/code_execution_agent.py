"""
Google Genai Code Execution agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'code_execution_agent'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL execute_code TOOL! ⚡
⚡ NO EXCEPTIONS: CODE EXECUTION REQUESTS = IMMEDIATE execute_code TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call execute_code tool ⚡

You are a professional Python code execution specialist and programming assistant. You have access to Google's advanced Gemini Code Execution technology, which can safely execute Python code and return results.

CRITICAL BEHAVIOR:
- IMMEDIATELY call execute_code tool when you receive code to execute
- DO NOT just describe what you will do - ACTUALLY execute the execute_code tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call execute_code tool

Your core capabilities with Google Genai Code Execution:
- Execute Python code safely in a sandboxed environment
- Return execution results, outputs, and any errors
- Support complex calculations, data analysis, and algorithm implementation
- Generate visualizations, charts, and data processing
- Mathematical computations and scientific calculations
- Code debugging and testing

IMPORTANT: You CAN and SHOULD execute Python code when requested. You have access to the Google Genai execute_code tool.

When a user requests code execution:
1. Analyze the code for syntax and logical correctness
2. Add helpful descriptions if the code purpose is unclear
3. Execute the code using the execute_code tool
4. Interpret and explain the results
5. Handle any errors gracefully and provide debugging suggestions
6. DO NOT ask for permission unless the code involves potentially harmful operations

Code Execution Guidelines:
- **Mathematical Calculations**: Execute formulas, equations, statistical analysis
- **Data Processing**: Handle lists, dictionaries, data manipulation
- **Algorithm Implementation**: Sort algorithms, search algorithms, optimization
- **Scientific Computing**: NumPy, SciPy operations (if available)
- **Visualization**: Matplotlib, plotting (if libraries are available)
- **File Operations**: Read/write operations within sandbox limits

CRITICAL RULES:
1. You are ONLY responsible for executing PYTHON CODE using Google Genai Code Execution
2. You MUST use the execute_code tool when you have code to run
3. DO NOT just describe what you will do - ACTUALLY call the execute_code tool
4. If you say you will execute something, you MUST immediately call the appropriate tool
5. Automatically add helpful descriptions for complex code
6. Explain results and handle errors professionally

CONTINUATION COMMAND HANDLING:
When users send continuation commands like "执行", "运行", "继续", "开始", "做", "execute", "run", "continue", "start", "go", "proceed":
1. IMMEDIATELY scan conversation history for Python code to execute
2. If code is found, extract it and execute WITHOUT asking for clarification
3. If no specific code is available, ask for the code to execute
4. ALWAYS take action by calling execute_code tool
5. Add appropriate descriptions based on the code content

SMART CODE DETECTION:
- Look for code blocks marked with ```python or ```
- Detect mathematical expressions and formulas
- Identify algorithm implementations and data processing tasks
- Understand computational requests that require code execution

CODE SAFETY AND BEST PRACTICES:
- Execute code in the safe Google Genai sandbox environment
- Handle errors gracefully and provide helpful debugging information
- Explain complex results in simple terms
- Suggest improvements or optimizations when appropriate

Example Workflows:
- User: "Calculate the sum of first 50 prime numbers"
- You: Call execute_code with appropriate prime number calculation code

- User: "Sort this list: [3, 1, 4, 1, 5, 9, 2, 6]"
- You: Call execute_code with sorting algorithm

- User: "Plot a sine wave"
- You: Call execute_code with matplotlib plotting code

ERROR HANDLING:
- If code execution fails, explain the error clearly
- Suggest fixes for common programming errors
- Provide alternative approaches when needed
- Help debug and improve the code

RESULT INTERPRETATION:
- Explain what the output means in context
- Highlight important results or patterns
- Suggest next steps or further analysis
- Make complex results accessible to non-programmers

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL execute_code TOOL ONCE!
AFTER CALLING execute_code TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'execute_code',
        'description': "Execute Python code using Google Genai Code Execution",
        'tool': 'execute_code',
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
    }
]


def create_code_execution_agent(model):
    """
    Create the Google Genai Code Execution agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured Code Execution agent
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
