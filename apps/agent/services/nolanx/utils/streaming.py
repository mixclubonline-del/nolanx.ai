"""
Streaming response handling utilities.
"""

import json
import traceback
from langchain_core.messages import AIMessageChunk, ToolCall, convert_to_openai_messages, ToolMessage
from services.websocket_service import send_session_update
from services.message_api_service import create_chat_message
from services.runtime_logger import log_runtime_event, log_runtime_exception, log_runtime_warning
from ..memory import sync_memory_snapshot


async def create_message_via_api(session_id: str, role: str, content, user_id: str = None):
    """
    Create a message via reelmind.server API instead of direct database access
    """
    return await create_chat_message(session_id=session_id, role=role, content=content, user_id=user_id)


async def handle_streaming_response(swarm, messages, ctx, session_id, user_id, canvas_id=None):
    """
    Handle streaming response from the swarm and manage WebSocket communication.

    Args:
        swarm: The compiled swarm instance
        messages: List of messages to process
        ctx: Context configuration
        session_id: Session identifier
        user_id: User identifier
    """
    tool_calls: list[ToolCall] = []
    last_saved_message_index = len(messages) - 1
    has_tool_calls = False  # 跟踪是否有工具调用
    current_agent = None  # 跟踪当前代理
    emitted_tool_calls: set[str] = set()
    emitted_tool_call_args_full: set[str] = set()
    streamed_tool_call_args: set[str] = set()
    emitted_tool_results: set[str] = set()
    failed = False

    try:
        async for chunk in swarm.astream(
            {"messages": messages},
            config=ctx,
            stream_mode=["messages", "custom", 'values']
        ):
            chunk_type = chunk[0]
            if chunk_type == 'values':
                all_messages = chunk[1].get('messages', [])

                # 修复 ToolMessage 的 name 字段以兼容 Gemini API
                for msg in all_messages:
                    if hasattr(msg, 'type') and msg.type == 'tool':
                        if not hasattr(msg, 'name') or not msg.name:
                            # 设置默认的 name 字段
                            msg.name = 'tool_response'
                            log_runtime_warning(
                                "stream.tool_message.name_missing",
                                tool_call_id=getattr(msg, 'tool_call_id', 'unknown'),
                                assigned_name='tool_response',
                            )

                oai_messages = convert_to_openai_messages(all_messages)
                for i in range(last_saved_message_index + 1, len(oai_messages)):
                    new_message = oai_messages[i]
                    if len(messages) > 0:
                        await create_message_via_api(session_id, new_message.get('role', 'user'), new_message, user_id)

                    # Emit tool-call cards even when tool_calls were forced by hooks (and thus may not appear in the message stream).
                    if new_message.get("role") == "assistant" and new_message.get("tool_calls"):
                        for tc in (new_message.get("tool_calls") or []):
                            tc_id = tc.get("id") or tc.get("tool_call_id")
                            tc_name = tc.get("name") or (tc.get("function") or {}).get("name")
                            tc_args = tc.get("args") or tc.get("arguments") or (tc.get("function") or {}).get("arguments") or "{}"
                            if isinstance(tc_args, dict):
                                tc_args = json.dumps(tc_args, ensure_ascii=False, indent=2)
                            else:
                                tc_args = str(tc_args or "{}")

                            if tc_id and tc_name and tc_id not in emitted_tool_calls:
                                emitted_tool_calls.add(tc_id)
                                await send_session_update(
                                    user_id,
                                    session_id,
                                    canvas_id,
                                    {"type": "tool_call", "id": tc_id, "name": tc_name, "arguments": tc_args},
                                )
                            # Only emit a full arguments payload when it is valid JSON and we haven't started streaming chunks.
                            if tc_id and (tc_id not in emitted_tool_call_args_full) and (tc_id not in streamed_tool_call_args):
                                try:
                                    json.loads(tc_args)
                                except Exception:
                                    pass
                                else:
                                    emitted_tool_call_args_full.add(tc_id)
                                    await send_session_update(
                                        user_id,
                                        session_id,
                                        canvas_id,
                                        {"type": "tool_call_arguments", "id": tc_id, "text": tc_args},
                                    )

                    # Stream tool results to UI as soon as they appear.
                    if new_message.get("role") == "tool":
                        tool_call_id = new_message.get("tool_call_id")
                        tool_content = new_message.get("content")
                        if isinstance(tool_content, (dict, list)):
                            tool_content = json.dumps(tool_content, ensure_ascii=False, indent=2)
                        else:
                            tool_content = str(tool_content or "")
                        if tool_call_id and tool_call_id not in emitted_tool_results:
                            emitted_tool_results.add(tool_call_id)
                            await send_session_update(
                                user_id,
                                session_id,
                                canvas_id,
                                {
                                    "type": "tool_result",
                                    "tool_call_id": tool_call_id,
                                    "content": tool_content,
                                },
                            )
                    last_saved_message_index = i
            else:
                # Access the AIMessageChunk
                ai_message_chunk: AIMessageChunk = chunk[1][0]
                content = ai_message_chunk.content  # Get the content from the AIMessageChunk
                if isinstance(ai_message_chunk, ToolMessage):
                    tool_call_id = getattr(ai_message_chunk, "tool_call_id", None)
                    tool_content = ai_message_chunk.content
                    if isinstance(tool_content, (dict, list)):
                        tool_content = json.dumps(tool_content, ensure_ascii=False, indent=2)
                    else:
                        tool_content = str(tool_content or "")

                    if tool_call_id and tool_call_id not in emitted_tool_results:
                        emitted_tool_results.add(tool_call_id)
                        await send_session_update(
                            user_id,
                            session_id,
                            canvas_id,
                            {
                                "type": "tool_result",
                                "tool_call_id": tool_call_id,
                                "content": tool_content,
                            },
                        )
                elif content:
                    await send_session_update(user_id, session_id, canvas_id, {
                        'type': 'delta',
                        'text': content
                    })
                elif hasattr(ai_message_chunk, 'tool_calls') and ai_message_chunk.tool_calls:
                    # Tool calls may be in OpenAI format:
                    #   {"id": "...", "type": "function", "function": {"name": "...", "arguments": "..."}}
                    # or in simplified format with a top-level "name".
                    def _tool_name(tc: dict) -> str | None:
                        return tc.get('name') or (tc.get('function', {}) or {}).get('name')

                    filtered_tool_calls = [tc for tc in ai_message_chunk.tool_calls if _tool_name(tc)]
                    if filtered_tool_calls:
                        tool_calls = filtered_tool_calls
                        has_tool_calls = True  # 标记有工具调用
                        log_runtime_event(
                            "stream.tool_call.detected",
                            agent=getattr(ai_message_chunk, "name", None),
                            tool_calls=ai_message_chunk.tool_calls,
                        )
                        for tool_call in tool_calls:
                            # Get the actual arguments from the tool call
                            arguments = '{}'
                            tool_name = _tool_name(tool_call)

                            # Try different possible argument locations
                            if 'function' in tool_call and 'arguments' in tool_call['function']:
                                arguments = tool_call['function']['arguments']
                            elif 'arguments' in tool_call:
                                arguments = tool_call['arguments']

                            # Ensure arguments is a string
                            if isinstance(arguments, dict):
                                arguments = json.dumps(arguments, indent=2)

                            log_runtime_event(
                                "stream.tool_call.arguments",
                                tool_call_id=tool_call.get('id'),
                                tool_name=tool_name,
                                arguments=arguments,
                            )

                            tc_id = tool_call.get('id')
                            if tc_id and tc_id in emitted_tool_calls:
                                continue

                            await send_session_update(user_id, session_id, canvas_id, {
                                'type': 'tool_call',
                                'id': tc_id,
                                'name': tool_name,
                                'arguments': arguments
                            })
                            if tc_id:
                                emitted_tool_calls.add(tc_id)
                elif hasattr(ai_message_chunk, 'tool_call_chunks'):
                    tool_call_chunks = ai_message_chunk.tool_call_chunks
                    for tool_call_chunk in tool_call_chunks:
                        index: int = tool_call_chunk['index']
                        if index < len(tool_calls):
                            for_tool_call: ToolCall = tool_calls[index]
                            tc_id = for_tool_call.get('id')
                            if not tc_id or tc_id in emitted_tool_call_args_full:
                                continue
                            text_chunk = tool_call_chunk.get('args')
                            if not text_chunk:
                                continue
                            streamed_tool_call_args.add(tc_id)
                            await send_session_update(user_id, session_id, canvas_id, {
                                'type': 'tool_call_arguments',
                                'id': tc_id,
                                'text': text_chunk
                            })
                else:
                    # 增强调试信息
                    log_runtime_event(
                        "stream.chunk.unclassified",
                        chunk=chunk,
                        content=content,
                        has_tool_calls=hasattr(ai_message_chunk, "tool_calls"),
                        tool_calls=getattr(ai_message_chunk, "tool_calls", []),
                        has_tool_call_chunks=hasattr(ai_message_chunk, "tool_call_chunks"),
                        tool_call_chunks=getattr(ai_message_chunk, "tool_call_chunks", []),
                        response_metadata=getattr(ai_message_chunk, "response_metadata", {}),
                        additional_kwargs=getattr(ai_message_chunk, "additional_kwargs", {}),
                        agent=getattr(ai_message_chunk, "name", None),
                    )

                    # 跟踪当前代理
                    if hasattr(ai_message_chunk, 'name') and ai_message_chunk.name:
                        current_agent = ai_message_chunk.name
    except Exception as e:
        failed = True
        log_runtime_exception(
            "stream.failed",
            e,
            session_id=session_id,
            user_id=user_id,
            canvas_id=canvas_id,
        )
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': str(e),
        })
        return False
    finally:
        try:
            await sync_memory_snapshot(user_id=user_id, session_id=session_id, canvas_id=canvas_id)
        except Exception as sync_exc:
            log_runtime_warning(
                "memory.sync.finally_failed",
                user_id=user_id,
                session_id=session_id,
                canvas_id=canvas_id,
                error=str(sync_exc),
            )

    # 检查是否需要工具调用但没有调用
    if current_agent in {'image_designer', 'script_writer'} and not has_tool_calls:
        log_runtime_warning(
            "stream.agent_completed_without_tool_call",
            agent=current_agent,
            has_tool_calls=has_tool_calls,
        )

        message = 'Agent completed without tool calls. This may indicate a provider/tool-calling issue.'
        if current_agent == 'image_designer':
            message = 'Image designer completed without generating image. This may indicate a configuration issue.'
        elif current_agent == 'script_writer':
            message = 'Script writer completed without generating structured output. This may indicate a provider/tool-calling issue.'

        # 发送警告事件
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'warning',
            'message': message
        })

    # Send completion event
    if not failed:
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'done'
        })
    return not failed
