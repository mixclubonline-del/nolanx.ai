"""
认证客户端 - 委托给reelmind.server进行认证
简洁版本，只保留必要功能
"""

import httpx
import time
from typing import Optional, Dict, Any
from services.config_service import config_service
import logging

logger = logging.getLogger(__name__)

class AuthClient:
    """认证客户端 - 委托给reelmind.server进行认证"""
    
    def __init__(self):
        # 从config.toml获取配置
        self.reelmind_server_url = config_service.get_reelmind_server_url()
        self.internal_api_key = config_service.get_internal_api_key()

        if not self.internal_api_key:
            raise ValueError("internal_api_key is required in config.toml [reelmind_server] section")
        
        # 简单缓存，避免频繁调用认证API
        self._cache = {}
        self._cache_ttl = 300  # 5分钟缓存
        
        logger.info(f"AuthClient initialized with server: {self.reelmind_server_url}")
    
    def _get_cache_key(self, token: str) -> str:
        """生成缓存键"""
        return f"auth_{token[-8:]}" if len(token) > 8 else f"auth_{token}"
    
    def _get_from_cache(self, token: str) -> Optional[Dict[str, Any]]:
        """从缓存获取认证结果"""
        cache_key = self._get_cache_key(token)
        cache_entry = self._cache.get(cache_key)
        
        if cache_entry and (time.time() - cache_entry['timestamp'] < self._cache_ttl):
            return cache_entry['user_info']
        
        return None
    
    def _set_cache(self, token: str, user_info: Optional[Dict[str, Any]]):
        """设置缓存"""
        cache_key = self._get_cache_key(token)
        self._cache[cache_key] = {
            'user_info': user_info,
            'timestamp': time.time()
        }
        
        # 简单缓存清理
        if len(self._cache) > 100:
            sorted_items = sorted(self._cache.items(), key=lambda x: x[1]['timestamp'])
            for key, _ in sorted_items[:50]:
                del self._cache[key]
    
    async def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        验证JWT token
        
        Args:
            token: JWT token字符串
            
        Returns:
            用户信息字典，如果验证失败返回None
        """
        if not token:
            logger.warning("Empty token provided")
            return None
        
        # 检查缓存
        cached_result = self._get_from_cache(token)
        if cached_result is not None:
            return cached_result
        
        # 调用reelmind.server验证
        user_info = await self._verify_with_server(token)
        
        # 缓存结果
        self._set_cache(token, user_info)
        
        return user_info
    
    async def _verify_with_server(self, token: str) -> Optional[Dict[str, Any]]:
        """调用reelmind.server验证token"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f'{self.reelmind_server_url}/auth/verify-token',
                    headers={
                        'Content-Type': 'application/json',
                        'X-Internal-API-Key': self.internal_api_key
                    },
                    json={'token': token}
                )
                
                # 处理成功状态码 (200, 201)
                if response.status_code in [200, 201]:
                    result = response.json()
                    logger.debug(f"Auth API response ({response.status_code}): {result}")

                    # 处理新的API响应格式: {code: 200, data: {success: true, user: {...}}}
                    if result.get('code') == 200 and result.get('data'):
                        data = result['data']
                        if data.get('success') and data.get('user'):
                            logger.info(f"Token verification successful for user: {data['user'].get('id')}")
                            return data['user']

                    # 处理旧的API响应格式: {success: true, user: {...}}
                    elif result.get('success') and result.get('user'):
                        logger.info(f"Token verification successful for user: {result['user'].get('id')}")
                        return result['user']

                    logger.warning(f"Token verification failed: {result}")
                    return None
                else:
                    logger.error(f"Authentication API error: {response.status_code}")
                    try:
                        error_detail = response.json()
                        logger.error(f"Error details: {error_detail}")
                    except:
                        logger.error(f"Error response: {response.text}")
                    return None
                    
        except httpx.ConnectError:
            logger.error(f"Cannot connect to reelmind.server at {self.reelmind_server_url}")
            return None
        except httpx.TimeoutException:
            logger.error("Authentication API timeout")
            return None
        except Exception as e:
            logger.error(f"Authentication error: {e}")
            return None


# 全局认证客户端实例
_auth_client = None

def get_auth_client() -> AuthClient:
    """获取全局认证客户端实例"""
    global _auth_client
    if _auth_client is None:
        _auth_client = AuthClient()
    return _auth_client


async def verify_websocket_auth(auth_data: Optional[Dict]) -> Optional[Dict[str, Any]]:
    """
    验证WebSocket认证数据
    
    Args:
        auth_data: 认证数据字典，应包含'token'字段
        
    Returns:
        用户信息字典，如果验证失败返回None
    """
    if not auth_data or not isinstance(auth_data, dict):
        logger.warning("Invalid auth data format")
        return None
    
    token = auth_data.get('token')
    if not token:
        logger.warning("No token provided in auth data")
        return None
    
    # 移除Bearer前缀（如果存在）
    if token.startswith('Bearer '):
        token = token[7:]
    
    auth_client = get_auth_client()
    user_info = await auth_client.verify_token(token)
    
    if user_info:
        logger.info(f"WebSocket authentication successful for user: {user_info.get('id')}")
        # 转换为兼容格式
        return {
            'user_id': user_info.get('id'),
            'email': user_info.get('email'),
            'user_metadata': user_info.get('user_metadata', {}),
            'app_metadata': user_info.get('app_metadata', {})
        }
    else:
        logger.warning("WebSocket authentication failed")
        return None
