# utils/rate_limiter.py
import os
import time
import asyncio
from typing import Dict, List, Optional
from collections import defaultdict, deque
import logging

from services.config_service import config_service

logger = logging.getLogger(__name__)

class RateLimiter:
    """WebSocket速率限制器"""
    
    def __init__(self):
        # 连接速率限制 (每IP每分钟最多10个连接)
        self.connection_attempts: Dict[str, deque] = defaultdict(deque)
        self.max_connections_per_ip_per_minute = 10
        
        # 消息速率限制 (每用户每秒最多5条消息)
        self.message_attempts: Dict[str, deque] = defaultdict(deque)
        self.max_messages_per_user_per_second = 5
        
        # 全局连接数限制
        self.max_total_connections = 1000
        self.current_connections = 0
        
        # 用户连接数限制 (每用户最多3个连接)
        self.user_connections: Dict[str, int] = defaultdict(int)
        default_max_per_user = "3"
        # Local dev: allow more concurrent tabs without getting disconnected.
        # You can still override via WS_MAX_CONNECTIONS_PER_USER.
        try:
            host = (config_service.get_server_host() or "").strip()
            if host in {"127.0.0.1", "localhost", "::1"}:
                default_max_per_user = "10"
        except Exception:
            pass

        self.max_connections_per_user = int(os.getenv("WS_MAX_CONNECTIONS_PER_USER", default_max_per_user))
        
        # 清理任务
        self.cleanup_task = None
        self.start_cleanup_task()

    def _sync_connection_counts(self, user_id: str):
        """Best-effort sync of counters with actual socket registry."""
        try:
            from services.websocket_state import get_connection_count, get_user_socket_ids
            self.current_connections = get_connection_count()
            self.user_connections[user_id] = len(get_user_socket_ids(user_id))
            if self.user_connections[user_id] <= 0:
                self.user_connections.pop(user_id, None)
        except Exception:
            # Avoid breaking connection flow on sync failures.
            return
    
    def start_cleanup_task(self):
        """启动定期清理任务"""
        if self.cleanup_task is None:
            self.cleanup_task = asyncio.create_task(self._cleanup_loop())
    
    async def _cleanup_loop(self):
        """定期清理过期记录"""
        while True:
            try:
                await asyncio.sleep(60)  # 每分钟清理一次
                self._cleanup_expired_records()
            except Exception as e:
                logger.error(f"Rate limiter cleanup error: {e}")
    
    def _cleanup_expired_records(self):
        """清理过期的速率限制记录"""
        current_time = time.time()
        
        # 清理连接尝试记录 (保留1分钟内的记录)
        for ip in list(self.connection_attempts.keys()):
            attempts = self.connection_attempts[ip]
            while attempts and current_time - attempts[0] > 60:
                attempts.popleft()
            if not attempts:
                del self.connection_attempts[ip]
        
        # 清理消息尝试记录 (保留1秒内的记录)
        for user_id in list(self.message_attempts.keys()):
            attempts = self.message_attempts[user_id]
            while attempts and current_time - attempts[0] > 1:
                attempts.popleft()
            if not attempts:
                del self.message_attempts[user_id]
    
    def check_connection_rate_limit(self, ip_address: str) -> bool:
        """
        检查连接速率限制
        
        Args:
            ip_address: 客户端IP地址
            
        Returns:
            True if allowed, False if rate limited
        """
        current_time = time.time()
        attempts = self.connection_attempts[ip_address]
        
        # 移除1分钟前的记录
        while attempts and current_time - attempts[0] > 60:
            attempts.popleft()
        
        # 检查是否超过限制
        if len(attempts) >= self.max_connections_per_ip_per_minute:
            logger.warning(f"Connection rate limit exceeded for IP {ip_address}")
            return False
        
        # 记录此次尝试
        attempts.append(current_time)
        return True
    
    def check_message_rate_limit(self, user_id: str) -> bool:
        """
        检查消息速率限制
        
        Args:
            user_id: 用户ID
            
        Returns:
            True if allowed, False if rate limited
        """
        current_time = time.time()
        attempts = self.message_attempts[user_id]
        
        # 移除1秒前的记录
        while attempts and current_time - attempts[0] > 1:
            attempts.popleft()
        
        # 检查是否超过限制
        if len(attempts) >= self.max_messages_per_user_per_second:
            logger.warning(f"Message rate limit exceeded for user {user_id}")
            return False
        
        # 记录此次尝试
        attempts.append(current_time)
        return True
    
    def check_global_connection_limit(self) -> bool:
        """
        检查全局连接数限制
        
        Returns:
            True if allowed, False if limit reached
        """
        if self.current_connections >= self.max_total_connections:
            logger.warning(f"Global connection limit reached: {self.current_connections}")
            return False
        return True
    
    def check_user_connection_limit(self, user_id: str) -> bool:
        """
        检查用户连接数限制
        
        Args:
            user_id: 用户ID
            
        Returns:
            True if allowed, False if limit reached
        """
        self._sync_connection_counts(user_id)
        user_conn_count = self.user_connections[user_id]
        if user_conn_count >= self.max_connections_per_user:
            logger.warning(f"User connection limit exceeded for user {user_id}: {user_conn_count}")
            return False
        return True
    
    def add_connection(self, user_id: str):
        """添加连接计数"""
        self.current_connections += 1
        self.user_connections[user_id] += 1
        logger.info(f"Connection added. Total: {self.current_connections}, User {user_id}: {self.user_connections[user_id]}")
    
    def remove_connection(self, user_id: str):
        """移除连接计数"""
        if self.current_connections > 0:
            self.current_connections -= 1
        
        if user_id in self.user_connections and self.user_connections[user_id] > 0:
            self.user_connections[user_id] -= 1
            if self.user_connections[user_id] == 0:
                del self.user_connections[user_id]
        
        logger.info(f"Connection removed. Total: {self.current_connections}, User {user_id}: {self.user_connections.get(user_id, 0)}")
    
    def get_stats(self) -> Dict:
        """获取速率限制统计信息"""
        return {
            'total_connections': self.current_connections,
            'max_total_connections': self.max_total_connections,
            'user_connections': dict(self.user_connections),
            'active_ips': len(self.connection_attempts),
            'active_users_with_messages': len(self.message_attempts)
        }

# 全局速率限制器实例
rate_limiter_instance = None

def get_rate_limiter() -> RateLimiter:
    """获取速率限制器实例（单例模式）"""
    global rate_limiter_instance
    if rate_limiter_instance is None:
        rate_limiter_instance = RateLimiter()
    return rate_limiter_instance

def check_connection_allowed(ip_address: str, user_id: str) -> tuple[bool, str]:
    """
    检查是否允许新连接
    
    Returns:
        (allowed: bool, reason: str)
    """
    limiter = get_rate_limiter()
    
    # 检查全局连接限制
    if not limiter.check_global_connection_limit():
        return False, "Server connection limit reached"
    
    # 检查IP连接速率限制
    if not limiter.check_connection_rate_limit(ip_address):
        return False, "Too many connection attempts from your IP"
    
    # 检查用户连接数限制
    if not limiter.check_user_connection_limit(user_id):
        return False, "Too many connections for this user"
    
    return True, ""

def check_message_allowed(user_id: str) -> tuple[bool, str]:
    """
    检查是否允许发送消息
    
    Returns:
        (allowed: bool, reason: str)
    """
    limiter = get_rate_limiter()
    
    if not limiter.check_message_rate_limit(user_id):
        return False, "Message rate limit exceeded"
    
    return True, ""
