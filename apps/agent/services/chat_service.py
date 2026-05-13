# services/chat_service.py

# Import necessary modules
import asyncio
import json
import re

# Import service modules
from services.nolanx_service import nolanx_multi_agent
from services.message_api_service import fetch_session_messages, broadcast_all_messages
from services.runtime_logger import log_runtime_event, log_runtime_warning
from services.websocket_service import send_session_update
from services.stream_service import add_stream_task, remove_stream_task


_CONTINUATION_REQUEST_RE = re.compile(
    r"^\s*(继续|繼續|continue|resume|go on|keep going|start|开始|開始|生成啊|执行|執行|proceed|next)\b",
    re.IGNORECASE,
)


def _extract_message_text(message: dict) -> str:
    content = (message or {}).get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item.get("text", ""))
        return "\n".join(parts).strip()
    return ""


def _is_continuation_request(messages: list[dict] | None) -> bool:
    for message in reversed(messages or []):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        return bool(_CONTINUATION_REQUEST_RE.search(_extract_message_text(message)))
    return False


def _message_fingerprint(message: dict) -> str | None:
    if not isinstance(message, dict):
        return None
    try:
        return json.dumps(message, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception:
        return None


def _merge_message_history(persisted_messages: list[dict], incoming_messages: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()

    for message in list(persisted_messages or []) + list(incoming_messages or []):
        if not isinstance(message, dict):
            continue
        fingerprint = _message_fingerprint(message)
        if fingerprint and fingerprint in seen:
            continue
        if fingerprint:
            seen.add(fingerprint)
        merged.append(message)

    return merged

async def handle_chat(data):
    """
    Handle an incoming chat request.

    Workflow:
    - Parse incoming chat data.
    - Optionally inject system prompt.
    - Save chat session and messages to the database.
    - Launch langgraph_agent task to process chat.
    - Manage stream task lifecycle (add, remove).
    - Notify frontend via WebSocket when stream is done.

    Args:
        data (dict): Chat request data containing:
            - messages: list of message dicts
            - session_id: unique session identifier
            - canvas_id: canvas identifier (contextual use)
            - text_model: text model configuration
            - image_model: image model configuration
    """
    # Extract fields from incoming data
    messages = data.get('messages')
    session_id = data.get('session_id')
    canvas_id = data.get('canvas_id')
    user_id = data.get('user_id')
    preferred_language = data.get('preferred_language')
    incoming_messages = list(messages or [])

    if session_id:
        persisted_messages = await fetch_session_messages(session_id=session_id)
        if persisted_messages:
            should_restore_full_history = _is_continuation_request(incoming_messages) or len(incoming_messages) < len(persisted_messages)
            if should_restore_full_history:
                messages = _merge_message_history(persisted_messages, incoming_messages)
                log_runtime_event(
                    "chat.history.restored",
                    session_id=session_id,
                    canvas_id=canvas_id,
                    user_id=user_id,
                    incoming_message_count=len(incoming_messages),
                    persisted_message_count=len(persisted_messages),
                    merged_message_count=len(messages or []),
                    continuation_request=_is_continuation_request(incoming_messages),
                )
                if user_id:
                    await broadcast_all_messages(
                        user_id=user_id,
                        session_id=session_id,
                        canvas_id=canvas_id,
                    )
            else:
                messages = incoming_messages
        else:
            messages = incoming_messages

    log_runtime_event(
        "chat.request.received",
        session_id=session_id,
        canvas_id=canvas_id,
        user_id=user_id,
        message_count=len(messages or []),
    )

    # Create and start langgraph_agent task for chat processing
    task = asyncio.create_task(
        nolanx_multi_agent(messages, canvas_id, session_id, user_id, preferred_language=preferred_language)
    )

    # Register the task in stream_tasks (for possible cancellation)
    add_stream_task(session_id, task)

    try:
        # Await completion of the langgraph_agent task
        await task
    except asyncio.exceptions.CancelledError:
        log_runtime_warning("chat.stream.cancelled", session_id=session_id, canvas_id=canvas_id, user_id=user_id)
    finally:
        # Always remove the task from stream_tasks after completion/cancellation
        remove_stream_task(session_id)
        log_runtime_event("chat.request.completed", session_id=session_id, canvas_id=canvas_id, user_id=user_id)
        # Notify frontend WebSocket that chat processing is done
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'done'
        })
