"""
HTTP 客户端工厂和管理器

本模块提供了统一的 HTTP 客户端创建和管理功能，基于 httpx 库封装，支持：
- 自动 SSL 证书验证
- 连接池管理和超时控制
- 同步和异步客户端支持

使用指南：
1. 单次/少量请求：使用 HttpClient.create() 自动管理资源
   async with HttpClient.create() as client:
       response = await client.get("https://api.example.com/data")

2. 长期持有客户端：使用 HttpClient.create_async_client() 手动管理
   client = HttpClient.create_async_client()
   try:
       response = await client.get("https://api.example.com/data")
   finally:
       await client.aclose()

3. 同步请求：使用 HttpClient.create_sync()
   with HttpClient.create_sync() as client:
       response = client.get("https://api.example.com/data")
"""
import ssl
import certifi
import httpx
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager, contextmanager
import logging

logger = logging.getLogger(__name__)


class HttpClient:
    """HTTP 客户端工厂和管理器"""

    _ssl_context: Optional[ssl.SSLContext] = None

    @classmethod
    def _get_ssl_context(cls) -> ssl.SSLContext:
        """获取缓存的 SSL 上下文"""
        if cls._ssl_context is None:
            try:
                cls._ssl_context = ssl.create_default_context(
                    cafile=certifi.where())
            except Exception as e:
                logger.warning(
                    f"Failed to create SSL context with certifi: {e}")
                cls._ssl_context = ssl.create_default_context()
        return cls._ssl_context

    @classmethod
    def _get_client_config(cls, url: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """获取客户端配置"""
        # 默认超时配置，适合大多数 AI API 调用
        default_timeout = httpx.Timeout(
            connect=20.0,   # 连接超时 20 秒
            read=120.0,     # 读取超时 2 分钟
            write=30.0,     # 写入超时 30 秒
            pool=60.0       # 连接池超时 60 秒
        )

        config = {
            'verify': cls._get_ssl_context(),
            'timeout': default_timeout,
            'follow_redirects': True,
            'limits': httpx.Limits(
                max_keepalive_connections=50,
                max_connections=200,
                keepalive_expiry=60.0
            ),
            **kwargs
        }

        # 检查是否需要代理配置
        # 首先检查是否应该绕过代理（包括环境变量中的代理）
        if url and cls._should_bypass_proxy(url):
            logger.debug(f"绕过代理访问: {url}")
            # 使用trust_env=False来禁用环境变量中的代理设置
            config['trust_env'] = False
        else:
            proxy_url = cls._get_proxy_config()
            if proxy_url:
                config['proxy'] = proxy_url
                logger.info(f"使用代理配置: {proxy_url}")

        return config

    @classmethod
    def _get_proxy_config(cls) -> Optional[str]:
        """获取代理配置，返回代理URL字符串"""
        import os

        # 优先使用环境变量
        https_proxy = os.getenv('HTTPS_PROXY') or os.getenv('https_proxy')
        http_proxy = os.getenv('HTTP_PROXY') or os.getenv('http_proxy')

        # 优先使用HTTPS代理，因为大多数API都是HTTPS
        if https_proxy:
            return https_proxy
        elif http_proxy:
            return http_proxy

        return None

    @classmethod
    def _should_bypass_proxy(cls, url: str) -> bool:
        """
        检查是否应该绕过代理

        绕过代理的服务：
        - 本地服务 (localhost, 127.0.0.1)

        使用代理的服务：
        - Gemini API (官方Google API和gptsapi.net端点)
        - fal.ai 相关服务 (图片、音频、视频生成)
        - ReelMind 外部 API
        - 其他外部API服务
        """
        import os
        from urllib.parse import urlparse

        # 解析URL获取主机名
        try:
            parsed = urlparse(url)
            hostname = parsed.hostname
            if not hostname:
                return False
        except Exception:
            return False

        # 检查NO_PROXY环境变量
        no_proxy = os.getenv('NO_PROXY') or os.getenv('no_proxy') or ''
        no_proxy_hosts = [host.strip() for host in no_proxy.split(',') if host.strip()]

        # 默认绕过localhost和127.0.0.1
        default_bypass = ['localhost', '127.0.0.1', '::1']

        # 开源版仅默认绕过本地服务；外部 AI 提供商遵循系统代理设置。
        service_bypass = []

        all_bypass_hosts = no_proxy_hosts + default_bypass + service_bypass

        # 检查是否匹配绕过列表
        for bypass_host in all_bypass_hosts:
            if hostname == bypass_host:
                logger.debug(f"绕过代理访问: {hostname}")
                return True
            # 检查子域名匹配（例如 *.fal.ai）
            if bypass_host.startswith('.') and hostname.endswith(bypass_host):
                logger.debug(f"绕过代理访问子域名: {hostname}")
                return True

        return False

    # ========== 工厂方法 ==========

    @classmethod
    @asynccontextmanager
    async def create(cls, url: Optional[str] = None, **kwargs):
        """创建异步客户端上下文管理器"""
        config = cls._get_client_config(url=url, **kwargs)
        client = httpx.AsyncClient(**config)
        try:
            yield client
        finally:
            await client.aclose()

    @classmethod
    @contextmanager
    def create_sync(cls, url: Optional[str] = None, **kwargs):
        """创建同步客户端上下文管理器"""
        config = cls._get_client_config(url=url, **kwargs)
        client = httpx.Client(**config)
        try:
            yield client
        finally:
            client.close()

    @classmethod
    def create_async_client(cls, url: Optional[str] = None, **kwargs) -> httpx.AsyncClient:
        """直接创建异步客户端（需要手动关闭）"""
        config = cls._get_client_config(url=url, **kwargs)
        return httpx.AsyncClient(**config)

    @classmethod
    def create_sync_client(cls, url: Optional[str] = None, **kwargs) -> httpx.Client:
        """直接创建同步客户端（需要手动关闭）"""
        config = cls._get_client_config(url=url, **kwargs)
        return httpx.Client(**config)
