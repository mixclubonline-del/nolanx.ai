# services/websocket_state.py
import socketio
from typing import Dict
from services.config_service import config_service
from services.runtime_logger import log_runtime_event

# 安全的CORS配置 - 只允许特定域名
def get_allowed_origins():
    """获取允许的CORS域名列表"""
    allowed_origins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://reelmind.ai",
        "https://www.reelmind.ai",
        "https://ws.reelmind.ai",
        "*"  # 临时允许所有域名进行调试
    ]

    log_runtime_event("websocket.cors.origins", allowed_origins=allowed_origins)
    return allowed_origins

sio = socketio.AsyncServer(
    cors_allowed_origins=get_allowed_origins(),
    async_mode='asgi'
)

active_connections: Dict[str, dict] = {}

def add_connection(socket_id: str, user_info: dict = None):
    active_connections[socket_id] = user_info or {}
    log_runtime_event(
        "websocket.connection.added",
        socket_id=socket_id,
        total_connections=len(active_connections),
        user_id=(user_info or {}).get("user_id"),
    )

def remove_connection(socket_id: str):
    if socket_id in active_connections:
        user_info = active_connections.get(socket_id) or {}
        del active_connections[socket_id]
        log_runtime_event(
            "websocket.connection.removed",
            socket_id=socket_id,
            total_connections=len(active_connections),
            user_id=user_info.get("user_id"),
        )

def get_all_socket_ids():
    return list(active_connections.keys())

def get_connection_count():
    return len(active_connections)

def get_connection_info(socket_id: str) -> dict:
    """获取指定socket的连接信息"""
    return active_connections.get(socket_id, {})

def get_user_socket_ids(user_id: str) -> list:
    """获取指定用户的所有socket连接ID"""
    user_sockets = []
    for socket_id, user_info in active_connections.items():
        if user_info.get('user_id') == user_id:
            user_sockets.append(socket_id)
    return user_sockets

def is_user_connected(user_id: str) -> bool:
    """检查用户是否有活跃连接"""
    return len(get_user_socket_ids(user_id)) > 0
