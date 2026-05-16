"""
Intent helpers shared by chat routing and LangGraph hooks.

The real continuation decision is made by an LLM before the graph starts and is
stored in the runnable config as `continuation_intent`. If the classifier fails,
the system does not guess; it returns False and lets the normal planner handle
the request.
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from services.runtime_logger import log_runtime_event, log_runtime_warning


def continuation_intent_from_config(configurable: dict[str, Any] | None, text: str = "") -> bool:
    if isinstance(configurable, dict) and isinstance(configurable.get("continuation_intent"), bool):
        return bool(configurable.get("continuation_intent"))
    return False


def _parse_intent_response(content: Any) -> bool | None:
    raw = str(content or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        parsed = json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except Exception:
            return None
    if not isinstance(parsed, dict):
        return None
    value = parsed.get("is_continuation")
    return bool(value) if isinstance(value, bool) else None


async def classify_continuation_intent_with_llm(
    *,
    model: Any,
    text: str,
    session_id: str | None = None,
    canvas_id: str | None = None,
    user_id: str | None = None,
) -> bool:
    user_text = str(text or "").strip()
    if not user_text:
        return False

    prompt = (
        "Classify whether the user's latest message intends to continue/resume/pick up an existing interrupted "
        "agent generation task, rather than starting a new creative request.\n"
        "Return JSON only: {\"is_continuation\": true|false}.\n"
        "Treat any language as valid. True examples include: continue, resume, pick up from here, keep going, "
        "Japanese/Korean/Chinese equivalents, or continue plus extra constraints. False examples include requests "
        "to create a new story/script/video or unrelated edits.\n\n"
        f"Latest user message:\n{user_text}"
    )

    try:
        response = await model.ainvoke(
            [
                SystemMessage(content="You are a strict multilingual intent classifier. Output JSON only."),
                HumanMessage(content=prompt),
            ]
        )
        result = _parse_intent_response(getattr(response, "content", response))
        if result is None:
            raise ValueError(f"unparseable intent response: {getattr(response, 'content', response)!r}")
        log_runtime_event(
            "intent.continuation.classified",
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
            is_continuation=result,
            text=user_text[:160],
        )
        return result
    except Exception as exc:
        log_runtime_warning(
            "intent.continuation.classification_failed",
            session_id=session_id,
            canvas_id=canvas_id,
            user_id=user_id,
            error=str(exc),
            fallback=False,
            text=user_text[:160],
        )
        return False
