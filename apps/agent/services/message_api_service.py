import aiohttp
from typing import Any

from services.config_service import config_service
from services.websocket_service import send_session_update


def _base_url() -> str:
    return config_service.get_reelmind_server_url().rstrip("/")


def chat_messages_url() -> str:
    return f"{_base_url()}/chat/messages"


def chat_session_messages_url(session_id: str) -> str:
    return f"{_base_url()}/chat/session/msgs/{session_id}"


async def create_chat_message(*, session_id: str, role: str, content: Any, user_id: str | None = None) -> Any | None:
    """
    Persist a chat message via reelmind.server.

    Note: reelmind.server chat_messages.role has a CHECK constraint:
      role IN ('user','assistant','system')
    We store non-allowed roles (e.g. 'tool') as role='assistant' but keep the original OpenAI message object in `content`.
    """
    if not session_id:
        return None

    store_role = role if role in ("user", "assistant", "system") else "assistant"

    payload: dict[str, Any] = {"session_id": session_id, "role": store_role, "content": content}
    if user_id:
        payload["user_id"] = user_id

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(chat_messages_url(), json=payload) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
                _ = await resp.text()
                return None
    except Exception:
        return None


async def fetch_session_messages(*, session_id: str) -> list[dict]:
    if not session_id:
        return []
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(chat_session_messages_url(session_id)) as resp:
                if resp.status != 200:
                    _ = await resp.text()
                    return []
                rows = await resp.json()
        if not isinstance(rows, list):
            return []
        messages: list[dict] = []
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("content"), dict):
                messages.append(row["content"])
        return messages
    except Exception:
        return []


async def broadcast_all_messages(*, user_id: str, session_id: str, canvas_id: str | None) -> None:
    msgs = await fetch_session_messages(session_id=session_id)
    await send_session_update(user_id, session_id, canvas_id or "", {"type": "all_messages", "messages": msgs})

