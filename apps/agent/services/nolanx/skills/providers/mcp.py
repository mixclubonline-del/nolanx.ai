"""MCP capability discovery and execution helpers for NolanX."""

from __future__ import annotations

from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from services.config_service import config_service


async def call_configured_mcp_tool(server_name: str, tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = config_service.get_service_config("nolanx") or {}
    servers = (cfg.get("mcp_servers", {}) or {})
    server_cfg = servers.get(server_name) or {}
    command = str(server_cfg.get("command") or "").strip()
    if not command:
        raise ValueError(f"MCP server '{server_name}' is not configured")

    args = [str(value) for value in list(server_cfg.get("args", []) or [])]
    env = server_cfg.get("env") or None

    async with AsyncExitStack() as stack:
        server_params = StdioServerParameters(command=command, args=args, env=env)
        stdio, write = await stack.enter_async_context(stdio_client(server_params))
        session = await stack.enter_async_context(ClientSession(stdio, write))
        await session.initialize()
        result = await session.call_tool(tool_name, arguments or {})
        return {
            "server": server_name,
            "tool": tool_name,
            "arguments": arguments or {},
            "result": getattr(result, "content", result),
        }


def get_mcp_server_catalog() -> list[dict[str, Any]]:
    cfg = config_service.get_service_config("nolanx") or {}
    servers = (cfg.get("mcp_servers", {}) or {})
    catalog: list[dict[str, Any]] = []
    for name, server_cfg in servers.items():
        if server_cfg.get("disabled"):
            continue
        catalog.append(
            {
                "name": name,
                "command": server_cfg.get("command"),
                "args": list(server_cfg.get("args", []) or []),
                "transport": server_cfg.get("transport", "stdio"),
                "description": server_cfg.get("description", ""),
            }
        )
    return catalog
