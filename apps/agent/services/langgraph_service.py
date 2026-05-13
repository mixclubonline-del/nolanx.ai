"""Compatibility shim for legacy LangGraph service imports."""

from .nolanx_service import langgraph_multi_agent, nolanx_multi_agent

__all__ = ["langgraph_multi_agent", "nolanx_multi_agent"]
