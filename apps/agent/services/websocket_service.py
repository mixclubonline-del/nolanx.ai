# services/websocket_service.py
from services.websocket_state import sio, active_connections, get_user_socket_ids
from services.runtime_logger import log_runtime_event, log_runtime_exception
import logging

logger = logging.getLogger(__name__)

async def send_to_user(user_id: str, event_type: str, data: dict):
    """
    向指定用户发送WebSocket消息

    Args:
        user_id: 目标用户ID
        event_type: 事件类型
        data: 消息数据
    """
    try:
        # 获取用户的所有socket连接
        user_sockets = get_user_socket_ids(user_id)

        if not user_sockets:
            logger.debug(f"User {user_id} has no active WebSocket connections")
            return

        # 向用户的所有连接发送消息
        sent_count = 0
        for socket_id in user_sockets:
            try:
                await sio.emit(event_type, data, room=socket_id)
                sent_count += 1
            except Exception as e:
                logger.error(f"Failed to send {event_type} to socket {socket_id}: {e}")

        logger.debug(f"Sent {event_type} to {sent_count} connections for user {user_id}")

    except Exception as e:
        logger.error(f"Error sending message to user {user_id}: {e}")

async def send_session_update(user_id: str, session_id: str, canvas_id: str, event: dict):
    """
    向用户发送会话更新消息

    Args:
        user_id: 目标用户ID
        session_id: 会话ID
        canvas_id: 画布ID (可选)
        event: 事件数据
    """
    message_data = {
        'session_id': session_id,
        'canvas_id': canvas_id,
        **event
    }

    await send_to_user(user_id, 'session_update', message_data)

async def send_canvas_update(user_id: str, canvas_id: str, event: dict):
    """
    向用户发送画布更新消息

    Args:
        user_id: 目标用户ID
        canvas_id: 画布ID
        event: 事件数据
    """
    message_data = {
        'canvas_id': canvas_id,
        **event
    }

    await send_to_user(user_id, 'canvas_update', message_data)

async def send_notification(user_id: str, notification: dict):
    """
    向用户发送通知消息

    Args:
        user_id: 目标用户ID
        notification: 通知数据
    """
    await send_to_user(user_id, 'notification', notification)

async def get_connected_users() -> list:
    """
    获取当前连接的所有用户ID列表
    """
    try:
        connected_users = set()
        for user_info in active_connections.values():
            user_id = user_info.get('user_id')
            if user_id:
                connected_users.add(user_id)
        return list(connected_users)
    except Exception as e:
        logger.error(f"Error getting connected users: {e}")
        return []

async def is_user_online(user_id: str) -> bool:
    """
    检查用户是否在线

    Args:
        user_id: 用户ID

    Returns:
        True if user is online, False otherwise
    """
    from services.websocket_state import is_user_connected
    return is_user_connected(user_id)

async def broadcast_init_done():
    """
    服务器启动时向所有连接的用户广播初始化完成消息
    这是唯一保留的广播函数，因为它是系统级消息
    """
    try:
        await sio.emit('init_done', {
            'type': 'init_done'
        })
        log_runtime_event("websocket.broadcast.init_done")
    except Exception as e:
        log_runtime_exception("websocket.broadcast.init_done.failed", e)
