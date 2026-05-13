import os
import sys
import io
import shutil
import glob
# Ensure stdout and stderr use utf-8 encoding to prevent emoji logs from crashing python server
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# Clear Python cache on startup
def clear_python_cache():
    """Clear Python cache files and directories"""
    try:
        # Remove __pycache__ directories
        for pycache_dir in glob.glob("**/__pycache__", recursive=True):
            if os.path.exists(pycache_dir):
                shutil.rmtree(pycache_dir)
                print(f"🧹 Removed cache directory: {pycache_dir}")

        # Remove .pyc files
        for pyc_file in glob.glob("**/*.pyc", recursive=True):
            if os.path.exists(pyc_file):
                os.remove(pyc_file)
                print(f"🧹 Removed cache file: {pyc_file}")

        print("✅ Python cache cleared successfully")
    except Exception as e:
        print(f"⚠️ Error clearing cache: {e}")

# Clear cache on startup
clear_python_cache()

from services.runtime_logger import setup_runtime_logging

setup_runtime_logging()

from routers import config, canvas, ssl_test, chat_router
import routers.websocket_router
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI
import asyncio
import argparse
from contextlib import asynccontextmanager
from starlette.types import Scope
from starlette.responses import Response
import socketio
from datetime import datetime
from services.websocket_state import sio
from services.websocket_service import broadcast_init_done

root_dir = os.path.dirname(__file__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # onstartup
    await broadcast_init_done()
    yield
    # onshutdown

app = FastAPI(lifespan=lifespan)

# Include routers
app.include_router(config.router)
app.include_router(canvas.router)
app.include_router(ssl_test.router)
app.include_router(chat_router.router)

# 健康检查端点
@app.get("/health")
async def health_check():
    """健康检查端点，返回服务状态"""
    from services.websocket_state import get_connection_count, get_allowed_origins
    from services.config_service import config_service

    config_data = config_service.get_config()
    environment = config_data.get('system', {}).get('environment', 'unknown')

    return {
        "status": "healthy",
        "service": "ReelMind Python WebSocket Service",
        "environment": environment,
        "websocket_connections": get_connection_count(),
        "cors_origins": get_allowed_origins(),
        "timestamp": str(datetime.now())
    }

# Mount the React build directory
react_build_dir = os.environ.get('UI_DIST_DIR', os.path.join(
    os.path.dirname(root_dir), "react", "dist"))


# 无缓存静态文件类
class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


static_site = os.path.join(react_build_dir, "assets")
if os.path.exists(static_site):
    app.mount("/assets", NoCacheStaticFiles(directory=static_site), name="assets")


@app.get("/")
async def serve_react_app():
    response = FileResponse(os.path.join(react_build_dir, "index.html"))
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path='/socket.io')

def print_startup_info(args, config_data):
    """打印启动信息和配置"""
    print("\n" + "="*60)
    print("🚀 ReelMind Python WebSocket Service Starting...")
    print("="*60)

    # 服务器信息
    from services.config_service import config_service
    config_host = config_service.get_server_host()
    config_port = config_service.get_server_port()

    print(f"🌐 Server Host: {args.host} {'(from config)' if args.host == config_host else '(from args)'}")
    print(f"🔌 Server Port: {args.port} {'(from config)' if args.port == config_port else '(from args)'}")
    print(f"📁 UI_DIST_DIR: {os.environ.get('UI_DIST_DIR', 'Not set')}")
    print(f"📂 Working Directory: {os.getcwd()}")

    # 环境信息
    environment = config_data.get('system', {}).get('environment', 'unknown')
    production_domain = config_data.get('system', {}).get('production_domain', 'not set')
    print(f"🏷️  Environment: {environment}")
    print(f"🌍 Production Domain: {production_domain}")

    # WebSocket CORS信息
    from services.websocket_state import get_allowed_origins
    allowed_origins = get_allowed_origins()
    print(f"🔗 WebSocket CORS Origins:")
    for origin in allowed_origins:
        print(f"   ✓ {origin}")

    # API配置
    reelmind_server_config = config_data.get('reelmind_server', {})
    print(f"🔄 ReelMind Server URL: {reelmind_server_config.get('url', 'not set')}")
    print(f"🔑 Internal API Key: {'***' + reelmind_server_config.get('internal_api_key', '')[-4:] if reelmind_server_config.get('internal_api_key') else 'not set'}")

    # 外部服务配置
    print(f"🤖 AI Services:")
    for service in ['deepseek', 'gemini', 'fal_ai']:
        service_config = config_data.get(service, {})
        if service_config:
            api_key = service_config.get('api_key', '')
            masked_key = '***' + api_key[-4:] if api_key else 'not set'
            print(f"   {service}: {masked_key}")

    print("="*60)
    print("🎯 Service URLs:")
    print(f"   WebSocket: ws://{args.host}:{args.port}/socket.io/")
    if args.host == "0.0.0.0":
        print(f"   External WebSocket: wss://ws.reelmind.ai/socket.io/")
    print(f"   Health Check: http://{args.host}:{args.port}/health")
    print("="*60 + "\n")

if __name__ == "__main__":
    # bypas localhost request for proxy, fix ollama proxy issue
    _bypass = {"127.0.0.1", "localhost", "::1"}
    current = set(os.environ.get("no_proxy", "").split(",")) | set(
        os.environ.get("NO_PROXY", "").split(","))
    os.environ["no_proxy"] = os.environ["NO_PROXY"] = ",".join(
        sorted(_bypass | current - {""}))

    # 获取配置信息
    from services.config_service import config_service
    config_data = config_service.get_config()

    # 从配置文件获取默认值
    default_host = config_service.get_server_host()
    default_port = config_service.get_server_port()

    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=default_port,
                        help=f'Port to run the server on (default: {default_port} from config)')
    parser.add_argument('--host', type=str, default=default_host,
                        help=f'Host to bind the server to (default: {default_host} from config)')
    args = parser.parse_args()

    # 打印启动信息
    print_startup_info(args, config_data)

    import uvicorn
    uvicorn.run(socket_app, host=args.host, port=args.port)
