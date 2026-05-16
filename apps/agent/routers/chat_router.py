#server/routers/chat_router.py
from fastapi import APIRouter, Request
from services.chat_service import handle_chat, persist_cancelled_resume_state
from services.stream_service import get_stream_task, get_stream_task_metadata
from services.video_gate_service import approve_video_gate

router = APIRouter(prefix="/api")

@router.post("/chat")
async def chat(request: Request):
    """
    Endpoint to handle chat requests.

    Receives a JSON payload from the client, passes it to the chat handler,
    and returns a success status.

    Request body:
        JSON object containing chat data.

    Response:
        {"status": "done"}
    """
    data = await request.json()
    await handle_chat(data)
    return {"status": "done"}

@router.post("/cancel/{session_id}")
async def cancel_chat(session_id: str):
    """
    Endpoint to cancel an ongoing stream task for a given session_id.

    If the task exists and is not yet completed, it will be cancelled.

    Path parameter:
        session_id (str): The ID of the session whose task should be cancelled.

    Response:
        {"status": "cancelled"} if the task was cancelled.
        {"status": "not_found_or_done"} if no such task exists or it is already done.
    """
    task = get_stream_task(session_id)
    metadata = get_stream_task_metadata(session_id) or {}
    await persist_cancelled_resume_state(
        session_id=session_id,
        canvas_id=metadata.get("canvas_id"),
        user_id=metadata.get("user_id"),
    )
    if task and not task.done():
        task.cancel()
        return {"status": "cancelled"}
    return {"status": "not_found_or_done"}


@router.post("/video-gate/{session_id}/approve")
async def approve_gate(session_id: str, request: Request):
    data = await request.json() if request.headers.get("content-length") else {}
    approved = approve_video_gate(session_id, str((data or {}).get("reason") or "generate_now"))
    return {"approved": approved}
