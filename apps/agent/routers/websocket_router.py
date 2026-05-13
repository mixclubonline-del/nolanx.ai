# routers/websocket_router.py
from services.websocket_state import sio, add_connection, remove_connection
from services.runtime_logger import log_runtime_event, log_runtime_exception, log_runtime_warning
from utils.auth_client import verify_websocket_auth
from utils.rate_limiter import check_connection_allowed, check_message_allowed, get_rate_limiter
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

@sio.event
async def connect(sid, environ, auth):
    """
    处理WebSocket连接事件，包含认证验证和速率限制
    """
    try:
        # 获取客户端信息
        client_ip = environ.get('REMOTE_ADDR', 'unknown')
        user_agent = environ.get('HTTP_USER_AGENT', 'unknown')
        origin = environ.get('HTTP_ORIGIN', 'unknown')
        host = environ.get('HTTP_HOST', 'unknown')
        referer = environ.get('HTTP_REFERER', 'unknown')

        # 检查CORS
        from services.websocket_state import get_allowed_origins
        allowed_origins = get_allowed_origins()
        origin_matched = origin in allowed_origins or '*' in allowed_origins
        log_runtime_event(
            "websocket.connect.attempt",
            socket_id=sid,
            client_ip=client_ip,
            origin=origin,
            host=host,
            referer=referer,
            user_agent=user_agent,
            allowed_origins=allowed_origins,
            origin_matched=origin_matched,
        )

        logger.info(f"WebSocket connection attempt from client {sid}, IP: {client_ip}, Origin: {origin}")

        # 验证认证信息
        user_info = await verify_websocket_auth(auth)
        if not user_info:
            log_runtime_warning("websocket.auth.failed", socket_id=sid, client_ip=client_ip, origin=origin)
            logger.warning(f"WebSocket authentication failed for client {sid}")
            await sio.emit('auth_error', {
                'error': 'Authentication failed',
                'message': 'Invalid or missing authentication token'
            }, room=sid)
            await sio.disconnect(sid)
            return False

        user_id = user_info.get('user_id')
        log_runtime_event("websocket.auth.succeeded", socket_id=sid, user_id=user_id)

        # 检查速率限制
        allowed, reason = check_connection_allowed(client_ip, user_id)
        if not allowed:
            log_runtime_warning(
                "websocket.connect.rate_limited",
                socket_id=sid,
                user_id=user_id,
                client_ip=client_ip,
                reason=reason,
            )
            logger.warning(f"WebSocket connection rate limited for client {sid}, user {user_id}: {reason}")
            await sio.emit('rate_limit_error', {
                'error': 'Rate limit exceeded',
                'message': reason
            }, room=sid)
            await sio.disconnect(sid)
            return False

        # 认证和速率检查通过，添加连接
        log_runtime_event("websocket.connect.succeeded", socket_id=sid, user_id=user_id, client_ip=client_ip)
        logger.info(f"WebSocket connection successful for client {sid}, user: {user_id}")
        add_connection(sid, user_info)

        # 更新速率限制器的连接计数
        rate_limiter = get_rate_limiter()
        rate_limiter.add_connection(user_id)

        # 发送连接成功消息
        await sio.emit('connected', {
            'status': 'connected',
            'user_id': user_id,
            'timestamp': str(datetime.now())
        }, room=sid)

        return True

    except Exception as e:
        log_runtime_exception("websocket.connect.failed", e, socket_id=sid)
        logger.error(f"WebSocket connection error for client {sid}: {e}")
        await sio.emit('connection_error', {
            'error': 'Connection failed',
            'message': 'An error occurred during connection'
        }, room=sid)
        await sio.disconnect(sid)
        return False

@sio.event
async def disconnect(sid):
    """
    处理WebSocket断开连接事件
    """
    try:
        # 获取用户信息
        from services.websocket_state import get_connection_info, get_connection_count
        user_info = get_connection_info(sid)
        user_id = user_info.get('user_id') if user_info else None

        log_runtime_event("websocket.disconnect", socket_id=sid, user_id=user_id)
        logger.info(f"Client {sid} disconnected, user: {user_id}")

        # 移除连接
        remove_connection(sid)

        # 更新速率限制器的连接计数
        if user_id:
            rate_limiter = get_rate_limiter()
            rate_limiter.remove_connection(user_id)

        log_runtime_event("websocket.connections.active", total_connections=get_connection_count())

    except Exception as e:
        log_runtime_exception("websocket.disconnect.failed", e, socket_id=sid)
        logger.error(f"Error handling disconnect for client {sid}: {e}")

@sio.event
async def ping(sid, data):
    """
    处理ping消息，用于保持连接活跃，包含消息速率限制
    """
    try:
        # 验证连接是否仍然有效
        from services.websocket_state import get_connection_info
        user_info = get_connection_info(sid)

        if not user_info:
            logger.warning(f"Ping from unauthorized client {sid}")
            await sio.disconnect(sid)
            return

        user_id = user_info.get('user_id')

        # 检查消息速率限制
        allowed, reason = check_message_allowed(user_id)
        if not allowed:
            logger.warning(f"Ping rate limited for client {sid}, user {user_id}: {reason}")
            await sio.emit('rate_limit_warning', {
                'warning': 'Message rate limit exceeded',
                'message': reason
            }, room=sid)
            return

        await sio.emit('pong', {
            'timestamp': str(datetime.now()),
            **data
        }, room=sid)

    except Exception as e:
        logger.error(f"Ping error for client {sid}: {e}")
        await sio.disconnect(sid)

@sio.event
async def get_stats(sid, data):
    """
    获取WebSocket服务器统计信息（仅限管理员）
    """
    try:
        # 验证连接是否仍然有效
        from services.websocket_state import get_connection_info, get_connection_count
        user_info = get_connection_info(sid)

        if not user_info:
            logger.warning(f"Stats request from unauthorized client {sid}")
            await sio.disconnect(sid)
            return

        # 获取统计信息
        rate_limiter = get_rate_limiter()
        stats = rate_limiter.get_stats()
        stats['websocket_connections'] = get_connection_count()

        await sio.emit('stats_response', {
            'stats': stats,
            'timestamp': str(datetime.now())
        }, room=sid)

    except Exception as e:
        logger.error(f"Stats error for client {sid}: {e}")
