# services/chat_service.py

# Import necessary modules
import asyncio
import json
from datetime import datetime, timezone

# Import service modules
from services.nolanx_service import nolanx_multi_agent
from services.message_api_service import fetch_session_messages, create_chat_message
from services.runtime_logger import log_runtime_event, log_runtime_warning
from services.websocket_service import send_session_update
from services.stream_service import add_stream_task, remove_stream_task, add_stream_task_metadata


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


async def persist_cancelled_resume_state(*, session_id: str, canvas_id: str | None, user_id: str | None) -> None:
    if not session_id:
        return

    snapshot = {
        "type": "storyboard_resume_state",
        "schemaVersion": 1,
        "resumeTool": "execute_storyboard",
        "resumeArgs": {"resume": False},
        "status": "cancelled",
        "phase": "cancelled",
        "sessionId": str(session_id or "").strip(),
        "canvasId": str(canvas_id or "").strip(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }

    await create_chat_message(
        session_id=session_id,
        role="assistant",
        user_id=user_id,
        content={
            "role": "assistant",
            "content": "<hide_in_user_ui> Storyboard resume state cancelled.</hide_in_user_ui>",
            "metadata": {"storyboard_resume_state": snapshot},
        },
    )

    if user_id:
        await send_session_update(
            user_id,
            session_id,
            canvas_id or "",
            {
                "type": "info",
                "info": "chat_cancelled",
                "data": {
                    "resumeStatus": "cancelled",
                    "sessionId": session_id,
                    "canvasId": canvas_id,
                },
            },
        )

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
            messages = _merge_message_history(persisted_messages, incoming_messages)
            log_runtime_event(
                "chat.history.restored",
                session_id=session_id,
                canvas_id=canvas_id,
                user_id=user_id,
                incoming_message_count=len(incoming_messages),
                persisted_message_count=len(persisted_messages),
                merged_message_count=len(messages or []),
            )
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
    add_stream_task_metadata(
        session_id,
        {
            "session_id": session_id,
            "canvas_id": canvas_id,
            "user_id": user_id,
        },
    )

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
