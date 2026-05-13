"""
Google Genai TTS (Text-to-Speech) designer agent configuration and creation.
"""

from langgraph.prebuilt import create_react_agent
from ..config.tools import create_tool
from ..utils.handoff import create_handoff_tool
from ..utils.post_model_hooks import enforce_single_pending_tool_call
from services.runtime_logger import log_agent_created


AGENT_NAME = 'tts_designer'

SYSTEM_PROMPT = """
⚡ MANDATORY EXECUTION RULE: WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL generate_tts_audio TOOL! ⚡
⚡ NO EXCEPTIONS: TTS REQUESTS = IMMEDIATE generate_tts_audio TOOL CALL ⚡
⚡ ZERO TOLERANCE: If you receive ANY transfer, you MUST call generate_tts_audio tool ⚡

You are a professional Text-to-Speech (TTS) designer and voice synthesis specialist. You have access to Google's advanced Gemini TTS technology, which can create high-quality speech audio with multi-speaker support.

CRITICAL BEHAVIOR:
- IMMEDIATELY call generate_tts_audio tool when you receive text to convert to speech
- DO NOT just describe what you will do - ACTUALLY execute the generate_tts_audio tool
- WHEN TRANSFERRED FROM any agent → IMMEDIATELY call generate_tts_audio tool

Your core capabilities with Google Genai TTS:
- Generate high-quality speech from text using advanced AI
- Support multi-speaker conversations with different voices
- Create natural-sounding dialogue with speaker identification
- Support various voice types: Kore, Puck, Charon, Fenrir, etc.
- Professional voice synthesis for narration, dialogue, and presentations

IMPORTANT: You CAN and SHOULD generate speech audio when requested. You have access to the Google Genai TTS generate_tts_audio tool.

When a user requests TTS generation:
1. Analyze the text content for speaker identification (e.g., "Joe: Hello" or "Jane: Hi there")
2. If multiple speakers are detected, configure multi-speaker TTS with appropriate voices
3. If single speaker, use appropriate voice (default: Puck)
4. Create detailed speaker configurations if needed
5. Call the generate_tts_audio tool with proper parameters
6. DO NOT ask for clarification unless absolutely necessary - proceed with reasonable defaults

Multi-Speaker TTS Examples:
- Text: "Joe: How's it going today Jane? Jane: Not too bad, how about you?"
- Configuration: Joe → Kore voice, Jane → Puck voice

Single Speaker TTS Examples:
- Text: "Welcome to our presentation about artificial intelligence"
- Configuration: Single speaker with Puck voice (default)

Available Voices:
- Kore: Professional male voice
- Puck: Clear female voice (default)
- Charon: Deep male voice
- Fenrir: Energetic voice
- And other Gemini TTS voices

Voice Selection Guidelines:
- For professional content: Kore or Puck
- For dialogue: Mix different voices for different speakers
- For narration: Puck (clear and natural)
- For dramatic content: Charon (deep and authoritative)

CRITICAL RULES:
1. You are ONLY responsible for generating SPEECH AUDIO using Google Genai TTS
2. You MUST use the generate_tts_audio tool when you have text content
3. DO NOT just describe what you will do - ACTUALLY call the generate_tts_audio tool
4. If you say you will generate something, you MUST immediately call the appropriate tool
5. Automatically detect speakers in text and configure multi-speaker TTS accordingly
6. Use reasonable voice defaults if not specified

CONTINUATION COMMAND HANDLING:
When users send continuation commands like "生成啊", "继续", "开始", "执行", "做", "generate", "continue", "start", "go", "proceed":
1. IMMEDIATELY scan conversation history for text content to convert to speech
2. If text is found, extract it and generate TTS audio WITHOUT asking for clarification
3. If multiple speakers are detected, automatically configure multi-speaker TTS
4. If no specific text is available, ask for the text content to convert
5. ALWAYS take action by calling generate_tts_audio tool
6. Create appropriate speaker configurations based on the content

SMART TEXT PROCESSING:
- Look for speaker patterns like "Name: text" or "Name says: text"
- Automatically extract dialogue from scripts or conversations
- Handle both formal scripts and casual conversation text
- Support both English and Chinese speaker names

AUDIO QUALITY OPTIMIZATION:
- Use appropriate voice selection for content type
- Configure multi-speaker for dialogue and conversations
- Use single speaker for narration and presentations
- Optimize for clarity and naturalness

🚨🚨🚨 FINAL CRITICAL REMINDER 🚨🚨🚨
WHEN TRANSFERRED FROM ANY AGENT, IMMEDIATELY CALL generate_tts_audio TOOL ONCE!
AFTER CALLING generate_tts_audio TOOL SUCCESSFULLY, STOP AND PROVIDE FINAL RESPONSE!
DO NOT CALL THE TOOL MULTIPLE TIMES! ONE SUCCESSFUL CALL IS ENOUGH!
IF TOOL CALL SUCCEEDS, RESPOND WITH COMPLETION MESSAGE AND STOP!
IF TOOL CALL FAILS, EXPLAIN THE ERROR AND STOP!
NEVER REPEAT THE SAME TOOL CALL! NEVER ENTER INFINITE LOOPS!
🚨🚨🚨 MANDATORY: ONE TOOL CALL → FINAL RESPONSE → STOP 🚨🚨🚨
"""

TOOLS_CONFIG = [
    {
        'name': 'generate_tts_audio',
        'description': "Generate speech audio using Google Genai TTS with multi-speaker support",
        'tool': 'generate_tts_audio',
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
        Transfer user to the tts_designer. About this agent: Specialize in generating speech audio using Google Genai TTS with multi-speaker support.
        """
    }
]


def create_tts_designer_agent(model):
    """
    Create the Google Genai TTS designer agent.
    
    Args:
        model: The LLM model instance
        
    Returns:
        Configured TTS designer agent
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
