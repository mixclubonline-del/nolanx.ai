"""
Post-model hooks for LangGraph ReAct agents.

Goal: make tool execution deterministic and sequential.
Gemini/OpenAI may emit multiple tool calls in one assistant message; in LangGraph v2
these can be dispatched in parallel. If a handoff tool runs in parallel, it can
interrupt other tool calls and lead to:
- INVALID_CHAT_HISTORY (tool_calls without ToolMessage)
- confusing/missing UI history (no all_messages updates after failure)
"""

from __future__ import annotations

import re
import json
import uuid
from typing import Any, Dict, List, Set

from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from .intent import continuation_intent_from_config


SCRIPT_WRITER_OUTPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": [
        "title",
        "premise",
        "style",
        "aspect_ratio",
        "total_duration_seconds",
        "story_metrics",
        "visual_bible",
        "shots",
        "audio",
        "safety",
        "screenplay",
        "bible",
        "script_segments",
    ],
    "properties": {
        "title": {"type": "string"},
        "premise": {"type": "string"},
        "style": {"type": "string"},
        "aspect_ratio": {"type": "string"},
        "total_duration_seconds": {"type": "number"},
        "story_metrics": {
            "type": "object",
            "required": [
                "requested_total_duration_seconds",
                "estimated_total_duration_seconds",
                "canonical_clip_duration_seconds",
                "clip_count",
            ],
            "properties": {
                "requested_total_duration_seconds": {"type": "number"},
                "estimated_total_duration_seconds": {"type": "number"},
                "canonical_clip_duration_seconds": {"type": "number"},
                "clip_count": {"type": "number"},
                "language": {"type": "string"},
            },
        },
        "screenplay": {
            "type": "object",
            "required": ["language", "text"],
            "properties": {
                "language": {"type": "string"},
                "text": {"type": "string"},
                "summary": {"type": "string"},
            },
        },
        "visual_bible": {
            "type": "object",
            "required": [
                "style_name",
                "aesthetic_principles",
                "cinematography_rules",
                "lighting_rules",
                "color_rules",
                "world_design_rules",
                "continuity_rules",
            ],
            "properties": {
                "style_name": {"type": "string"},
                "aesthetic_principles": {"type": "string"},
                "cinematography_rules": {"type": "string"},
                "lighting_rules": {"type": "string"},
                "color_rules": {"type": "string"},
                "world_design_rules": {"type": "string"},
                "continuity_rules": {"type": "string"},
                "character_design_rules": {"type": "string"},
                "prop_design_rules": {"type": "string"},
                "multi_subject_staging_rules": {"type": "string"},
                "negative_constraints": {"type": "string"},
            },
        },
        "bible": {
            "type": "object",
            "required": ["elements"],
            "properties": {
                "elements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": [
                            "id",
                            "kind",
                            "name",
                            "importance",
                            "description",
                            "image_prompt_en",
                            "aspect_ratio"
                        ],
                        "properties": {
                            "id": {"type": "string"},
                            "kind": {"type": "string"},
                            "name": {"type": "string"},
                            "importance": {"type": "number"},
                            "description": {"type": "string"},
                            "image_prompt_en": {"type": "string"},
                            "aspect_ratio": {"type": "string"},
                            "linked_shot_indexes": {"type": "array", "items": {"type": "number"}},
                            "visual_invariants": {"type": "string"},
                            "aesthetic_binding": {"type": "string"},
                            "design_language": {"type": "string"},
                            "palette_notes": {"type": "string"},
                            "staging_notes": {"type": "string"},
                            "tags": {"type": "array", "items": {"type": "string"}},
                            "voice_profile": {
                                "type": "object",
                                "properties": {
                                    "voice_id": {"type": "string"},
                                    "voice_name": {"type": "string"},
                                    "language": {"type": "string"},
                                    "gender_presentation": {"type": "string"},
                                    "age_tone": {"type": "string"},
                                    "timbre": {"type": "string"},
                                    "speaking_style": {"type": "string"},
                                    "pace_wpm": {"type": "number"},
                                    "pitch": {"type": "string"},
                                    "energy": {"type": "string"},
                                    "accent": {"type": "string"},
                                    "reference_line": {"type": "string"},
                                    "tts_voice_hint_en": {"type": "string"},
                                },
                            },
                        },
                    },
                }
            },
        },
        "script_segments": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["shot_index", "start_sec", "end_sec", "text", "world_refs"],
                "properties": {
                    "shot_index": {"type": "number"},
                    "start_sec": {"type": "number"},
                    "end_sec": {"type": "number"},
                    "title": {"type": "string"},
                    "text": {"type": "string"},
                    "world_refs": {"type": "array", "items": {"type": "string"}},
                    "binding_lock": {"type": "string"},
                    "dialogue": {"type": "string"},
                    "sound_effects": {"type": "string"},
                    "continuity_note": {"type": "string"},
                    "subshot_summary": {"type": "string"},
                    "voice_refs": {"type": "array", "items": {"type": "string"}},
                    "aesthetic_notes": {"type": "string"},
                    "visual_style_ref": {"type": "string"},
                },
            },
        },
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "index",
                    "start_sec",
                    "end_sec",
                    "duration_seconds",
                    "binding_lock",
                    "shot_description",
                    "shot_size",
                    "character_action",
                    "emotion",
                    "scene_tag",
                    "lighting_mood",
                    "sound_effects",
                    "dialogue",
                    "storyboard_prompt",
                    "visual_prompt_en",
                    "motion_prompt_en",
                    "world_refs",
                    "recommended_video_mode",
                    "video_primary_world_ref",
                    "characters",
                    "subshots",
                ],
                "properties": {
                    "index": {"type": "number"},
                    "start_sec": {"type": "number"},
                    "end_sec": {"type": "number"},
                    "duration_seconds": {"type": "number"},
                    "binding_lock": {"type": "string"},
                    "shot_label": {"type": "string"},
                    "shot_description": {"type": "string"},
                    "reference_notes": {"type": "string"},
                    "continuity_note": {"type": "string"},
                    "shot_size": {"type": "string"},
                    "character_action": {"type": "string"},
                    "emotion": {"type": "string"},
                    "scene_tag": {"type": "string"},
                    "lighting_mood": {"type": "string"},
                    "aesthetic_notes": {"type": "string"},
                    "composition_notes": {"type": "string"},
                    "camera_language": {"type": "string"},
                    "palette_notes": {"type": "string"},
                    "sound_effects": {"type": "string"},
                    "dialogue": {"type": "string"},
                    "voice_direction": {"type": "string"},
                    "storyboard_prompt": {"type": "string"},
                    "keyframe_notes": {"type": "string"},
                    "world_refs": {"type": "array", "items": {"type": "string"}},
                    "video_primary_world_ref": {"type": "string"},
                    "asset_bindings": {"type": "array", "items": {"type": "string"}},
                    "characters": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["code", "name", "description"],
                            "properties": {
                                "code": {"type": "string"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "voice_profile_ref": {"type": "string"},
                                "voice_direction": {"type": "string"},
                            },
                        },
                    },
                    "locations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["code", "name", "description"],
                            "properties": {
                                "code": {"type": "string"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                            },
                        },
                    },
                    "props": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["code", "name", "description"],
                            "properties": {
                                "code": {"type": "string"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                            },
                        },
                    },
                    "subshots": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["label", "start_offset_sec", "end_offset_sec", "beat_description"],
                            "properties": {
                                "label": {"type": "string"},
                                "start_offset_sec": {"type": "number"},
                                "end_offset_sec": {"type": "number"},
                                "beat_description": {"type": "string"},
                                "camera": {"type": "string"},
                                "action": {"type": "string"},
                                "emotion": {"type": "string"},
                                "audio": {"type": "string"},
                                "focus_world_refs": {"type": "array", "items": {"type": "string"}},
                                "dialogue": {"type": "string"},
                                "voice_ref": {"type": "string"},
                                "voice_direction": {"type": "string"},
                            },
                        },
                    },
                    "dialogue_lines": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["speaker_code", "speaker_name", "text"],
                            "properties": {
                                "speaker_code": {"type": "string"},
                                "speaker_name": {"type": "string"},
                                "voice_ref": {"type": "string"},
                                "text": {"type": "string"},
                                "delivery": {"type": "string"},
                                "pace": {"type": "string"},
                                "start_offset_sec": {"type": "number"},
                                "end_offset_sec": {"type": "number"},
                            },
                        },
                    },
                    "visual_prompt_en": {"type": "string"},
                    "motion_prompt_en": {"type": "string"},
                    "recommended_keyframe_method": {"type": "string", "enum": ["generate_image", "edit_image", "skip"]},
                    "reference_keyframe_index": {"type": "number"},
                    "recommended_video_mode": {"type": "string", "enum": ["image_to_video", "first_last_frame"]},
                    "keyframe_prompt_en": {"type": "string"},
                    "keyframe_edit_prompt_en": {"type": "string"},
                    "first_frame_prompt_en": {"type": "string"},
                    "last_frame_prompt_en": {"type": "string"},
                },
            },
        },
        "audio": {
            "type": "object",
            "required": ["needs_audio"],
            "properties": {
                "needs_audio": {"type": "boolean"},
                "bpm": {"type": "number"},
                "sfx_prompt_en": {"type": "string"},
                "music_prompt_en": {"type": "string"},
                "voice_cast": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["character_code", "character_name", "voice_ref"],
                        "properties": {
                            "character_code": {"type": "string"},
                            "character_name": {"type": "string"},
                            "voice_ref": {"type": "string"},
                            "performance_notes": {"type": "string"},
                            "single_voice_hint_en": {"type": "string"},
                        },
                    },
                },
            },
        },
        "safety": {
            "type": "object",
            "required": ["content_policy_notes"],
            "properties": {"content_policy_notes": {"type": "string"}},
        },
    },
}


def _is_handoff_tool(tool_name: str | None) -> bool:
    return bool(tool_name) and tool_name.startswith("transfer_to_")


def _looks_like_storyboard_json(text: str) -> bool:
    if not isinstance(text, str):
        return False
    # Structured output tool prints a marker, but fallback to key fields too.
    if "**Structured Output:**" in text:
        return True
    if "**Structured Output Cached:**" in text:
        return True
    return ('"shots"' in text) and ('"visual_prompt_en"' in text or '"motion_prompt_en"' in text)


def _forced_tool_call(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a LangGraph-compatible synthetic tool call with a stable id."""
    return {
        "id": f"forced_{name}_{uuid.uuid4().hex}",
        "name": name,
        "args": args,
        "type": "tool_call",
    }


def _tool_call_name(tool_call: Dict[str, Any]) -> str:
    return str(tool_call.get("name") or (tool_call.get("function") or {}).get("name") or "").strip()


def _is_continuation_request(state: Dict[str, Any], text: str) -> bool:
    configurable = (state or {}).get("configurable") or {}
    return continuation_intent_from_config(configurable, text)


def _last_human_message_text(messages: List[Any]) -> str:
    for message in reversed(messages or []):
        if isinstance(message, HumanMessage):
            return str(getattr(message, "content", "") or "").strip()
    return ""


def _last_human_message_index(messages: List[Any]) -> int | None:
    for index in range(len(messages or []) - 1, -1, -1):
        if isinstance(messages[index], HumanMessage):
            return index
    return None


def _tool_returned_after_last_user(messages: List[Any], tool_name: str) -> bool:
    last_user_idx = _last_human_message_index(messages)
    if last_user_idx is None:
        return False
    for message in messages[last_user_idx + 1 :]:
        if isinstance(message, ToolMessage) and getattr(message, "name", None) == tool_name:
            return True
    return False


def _latest_resume_target(
    state: Dict[str, Any],
    messages: List[Any],
    *,
    allowed_tools: set[str],
) -> Dict[str, Any] | None:
    last_user_text = _last_human_message_text(messages)
    if not _is_continuation_request(state, last_user_text):
        return None

    configurable = (state or {}).get("configurable") or {}
    interrupted_tool_call = configurable.get("interrupted_tool_call")
    if not isinstance(interrupted_tool_call, dict):
        return None

    tool_name = str(interrupted_tool_call.get("name") or "").strip()
    tool_args = interrupted_tool_call.get("args")
    if not tool_name or tool_name not in allowed_tools or not isinstance(tool_args, dict):
        return None

    if _tool_returned_after_last_user(messages, tool_name):
        return None

    if tool_name == "execute_storyboard" and "resume" not in tool_args:
        tool_args = {**tool_args, "resume": True}

    return {"name": tool_name, "args": dict(tool_args)}


def _force_resume_tool_call(
    state: Dict[str, Any],
    messages: List[Any],
    *,
    allowed_tools: set[str],
) -> Dict[str, Any]:
    resume_target = _latest_resume_target(state, messages, allowed_tools=allowed_tools)
    if not resume_target:
        return {}

    last_ai: AIMessage | None = None
    for message in reversed(messages or []):
        if isinstance(message, AIMessage):
            last_ai = message
            break

    if last_ai is None:
        return {}

    forced = [_forced_tool_call(resume_target["name"], resume_target["args"])]
    updated_ai = last_ai.model_copy(update={"tool_calls": forced})
    return {"messages": [updated_ai]}


def _resume_handoff_target(tool_name: str) -> str | None:
    mapping = {
        "generate_video": "transfer_to_video_designer",
        "generate_video_first_last_frame": "transfer_to_flf_video_designer",
        "generate_image": "transfer_to_image_designer",
        "edit_image": "transfer_to_image_edit_agent",
        "generate_audio": "transfer_to_audio_designer",
        "generate_tts_audio": "transfer_to_tts_designer",
        "generate_music": "transfer_to_music_designer",
        "execute_code": "transfer_to_code_execution_agent",
        "analyze_documents": "transfer_to_document_analyzer_agent",
        "generate_structured_output": "transfer_to_structured_output_agent",
        "analyze_media": "transfer_to_media_analyzer_agent",
        "execute_function_call": "transfer_to_function_calling_agent",
        "analyze_web_context": "transfer_to_web_context_agent",
        "search_and_generate": "transfer_to_search_agent",
    }
    return mapping.get(str(tool_name or "").strip())


def _force_resume_handoff(state: Dict[str, Any], messages: List[Any]) -> Dict[str, Any]:
    resume_target = _latest_resume_target(state, messages, allowed_tools=set())
    if not resume_target:
        configurable = (state or {}).get("configurable") or {}
        interrupted_tool_call = configurable.get("interrupted_tool_call")
        if not isinstance(interrupted_tool_call, dict):
            return {}
        last_user_text = _last_human_message_text(messages)
        if not _is_continuation_request(state, last_user_text):
            return {}
        tool_name = str(interrupted_tool_call.get("name") or "").strip()
        tool_args = interrupted_tool_call.get("args")
        if not tool_name or not isinstance(tool_args, dict):
            return {}
        if _tool_returned_after_last_user(messages, tool_name):
            return {}
        resume_target = {"name": tool_name, "args": dict(tool_args)}

    handoff_tool = _resume_handoff_target(resume_target["name"])
    if not handoff_tool:
        return {}

    last_ai: AIMessage | None = None
    for message in reversed(messages or []):
        if isinstance(message, AIMessage):
            last_ai = message
            break
    if last_ai is None:
        return {}

    context = (
        f"Resume the interrupted `{resume_target['name']}` call exactly from the previous chat continuation request. "
        f"Reuse these arguments as the first action without redesigning the workflow: "
        f"{json.dumps(resume_target['args'], ensure_ascii=False)}"
    )
    forced = [_forced_tool_call(handoff_tool, {"context": context})]
    updated_ai = last_ai.model_copy(update={"tool_calls": forced})
    return {"messages": [updated_ai]}


def _has_prior_generation_context(messages: List[Any], last_user_idx: int | None) -> bool:
    if last_user_idx is None:
        return False

    for message in messages[:last_user_idx]:
        if isinstance(message, ToolMessage):
            return True
        if isinstance(message, AIMessage) and getattr(message, "tool_calls", None):
            return True
    return False


def _is_fresh_request_without_generation_context(state: Dict[str, Any], messages: List[Any]) -> bool:
    last_user_text = _last_human_message_text(messages)
    if not last_user_text or _is_continuation_request(state, last_user_text):
        return False

    last_user_idx = _last_human_message_index(messages)
    if _has_prior_generation_context(messages, last_user_idx):
        return False

    return True


def _build_script_writer_fallback_prompt(last_user_text: str) -> str:
    return (
        "Create a detailed production storyboard for the user request below.\n"
        "RULES:\n"
        "- Output MUST follow the provided JSON Schema exactly (no extra keys).\n"
        "- Keep all text fields compact and production-usable; avoid markdown, code fences, JSON snippets, and heavy nested quotation inside string values.\n"
        "- shots[].index starts at 1.\n"
        "- Split the requested story into many 15-second clips unless the user explicitly requires otherwise.\n"
        "- Every shot must include a detailed shot table row, plus subshots covering the internal 15-second beat design.\n"
        "- Write each shot like a production spreadsheet row: duration, frame description, main characters, character descriptions, shot size, action, emotion, scene tag, lighting mood, sound effects, dialogue, storyboard prompt, motion prompt.\n"
        "- Inside each 15-second shot, use motivated cinematic subshots, usually 4-8 beats across the clip.\n"
        "- Build each clip with a clear editorial flow: entry hook, internal escalation, exit bridge.\n"
        "- Make subshot changes motivated by action, eyeline, reaction, sound cue, power shift, or reveal.\n"
        "- If dialogue is present, use coverage to support speaking, listening, interruption, and subtext without chopping lines unnaturally.\n"
        "- Design clip-to-clip continuity deliberately and avoid duplicated boundary beats.\n"
        "- Create a top-level visual_bible that locks the global look, cinematography, lighting, color logic, world design rules, and continuity rules for the entire piece.\n"
        "- Infer one global format intent: overseas short drama / domestic short drama / cinematic film / advertisement / general video.\n"
        "- Choose one top-level aspect_ratio for the whole package:\n"
        "  * 9:16 for phone-first short drama / vertical mobile storytelling\n"
        "  * 2.39:1 for cinematic film language / premium movie-like visuals\n"
        "  * 16:9 for standard horizontal ads and general web video\n"
        "- Keep that aspect ratio consistent across the whole package.\n"
        "- If the user provided specialized overlays such as overseas short drama adaptation, character-sheet / three-view modeling, or no-human pure-scene extraction, integrate them into the package rather than dropping them.\n"
        "- Character-sheet / three-view requirements apply to character reference assets, not to narrative video shots; story shots must show the character in-scene rather than as a white-background model sheet.\n"
        "- For character-sheet / three-view assets, use a pure white seamless background, one character only, and full-body front / side / back views with strict identity consistency.\n"
        "- In short-drama mode, make the first 3 seconds hit with conflict, danger, pressure, reversal, or emotional burst, and prefer a meaningful framing change about every 2 seconds unless a longer take is stronger.\n"
        "- The opening of the piece should usually start on a key scene with strong playable behavior, volatile emotion, confrontation, danger, revelation, or other high-retention dramatic action rather than neutral setup coverage.\n"
        "- Every shot, character, location, prop, and multi-character staging choice must inherit that same visual_bible rather than drifting into unrelated aesthetics.\n"
        "- `lighting_mood` must be specific and shootable, not generic.\n"
        "- `sound_effects` must be concrete and editorially useful.\n"
        "- `dialogue` may be an empty string when the beat should remain silent.\n"
        "- Every shot must have a stable `binding_lock` and exact `world_refs` / `video_primary_world_ref` values.\n"
        "- `characters`, `locations`, and `props` in each shot must correspond exactly to bible/world element ids.\n"
        "- Build the Script Track first so its rows/subshots are readable before World Track assets exist.\n"
        "- Then derive reusable world assets from the stabilized shots.\n"
        "- script_segments MUST be 1:1 aligned with shots (same count and timings).\n"
        "- Provide a reusable bible.elements list with stable world codes like CHR1, LOC1, PROP1, STYLE1, MOOD1.\n"
        "- Each bible element should include aesthetic binding notes so World Track assets stay visually unified across characters, scenes, props, and crowd-heavy compositions.\n"
        "- world_refs in shots and script_segments MUST reference bible element ids.\n"
        "- Keep user-facing writing in the user's language and preserve the original IP / names / plot facts.\n"
        "- Fields ending in `_en` must stay English.\n\n"
        f"USER REQUEST:\n{last_user_text.strip()}"
    ).strip()


def _augment_storyboard_prompt(prompt: str) -> str:
    prompt_text = str(prompt or "").strip()
    if not prompt_text:
        return prompt_text

    overlay_lines = []
    if "every 2 seconds" not in prompt_text.lower():
        overlay_lines.append(
            "- Unless the user explicitly requests a sustained take, every 2 seconds should contain at least one meaningful subshot / camera beat."
        )
    if "first 3 seconds" not in prompt_text.lower():
        overlay_lines.append(
            "- The first 3 seconds of the piece and of each major clip should land with conflict, pressure, danger, confrontation, reversal, revelation, or an emotional burst."
        )
    if "@视频n" not in prompt_text.lower():
        overlay_lines.append(
            "- When world-asset videos are derived later, characters, locations, and props should all be bindable as explicit `@视频N（名字 / 类型）` anchors, including location/world assets."
        )
    if "key scene" not in prompt_text.lower() and "strong playable behavior" not in prompt_text.lower():
        overlay_lines.append(
            "- The opening should usually begin on a key scene image with strong playable behavior, intense acting, micro-expression readability, or an unstable dramatic situation rather than neutral scene-setting."
        )

    if not overlay_lines:
        return prompt_text

    return (
        f"{prompt_text}\n\n"
        "MANDATORY STORYBOARD EXECUTION OVERLAY:\n"
        + "\n".join(overlay_lines)
    ).strip()


def script_writer_post_model_hook(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Script-writer-specific hook:
    - Keep tool execution sequential
    - After `generate_structured_output` returns a storyboard, force `execute_storyboard`
      directly so the pipeline does not bounce a heavy storyboard back through planner.
    """
    original_messages: List[Any] = state.get("messages", [])
    update = enforce_single_pending_tool_call(state) or {}
    messages: List[Any] = (update.get("messages") or original_messages or [])
    if not messages:
        return update

    resume_update = _force_resume_tool_call(
        state,
        original_messages,
        allowed_tools={"generate_structured_output", "execute_storyboard"},
    )
    if resume_update:
        return resume_update

    last_structured_idx: int | None = None
    last_execute_idx: int | None = None
    last_execute_ok = False
    for i, m in enumerate(messages):
        if isinstance(m, ToolMessage) and getattr(m, "name", None) == "generate_structured_output":
            content = getattr(m, "content", "") or ""
            if _looks_like_storyboard_json(content):
                last_structured_idx = i
        if isinstance(m, ToolMessage) and getattr(m, "name", None) == "execute_storyboard":
            last_execute_idx = i
            content = getattr(m, "content", "") or ""
            last_execute_ok = isinstance(content, str) and "execute_storyboard completed:" in content

    if last_structured_idx is None:
        # Safety net: some providers occasionally return an empty assistant message with no tool calls.
        # For script_writer, we *must* call `generate_structured_output`; if the model fails to do so,
        # force a deterministic tool call using the last user request.
        last_ai: AIMessage | None = None
        for m in reversed(messages):
            if isinstance(m, AIMessage):
                last_ai = m
                break

        if last_ai is None:
            return update

        existing_calls = list(last_ai.tool_calls or [])
        has_any_tool_call = any((tc.get("name") or (tc.get("function") or {}).get("name")) for tc in existing_calls)
        has_structured_call = any(
            (tc.get("name") or (tc.get("function") or {}).get("name")) == "generate_structured_output"
            for tc in existing_calls
        )
        last_user_text = ""
        for m in reversed(messages):
            if isinstance(m, HumanMessage):
                last_user_text = getattr(m, "content", "") or ""
                break
        fallback_prompt = _build_script_writer_fallback_prompt(last_user_text)

        if has_structured_call:
            prompt = ""
            for tc in existing_calls:
                name = tc.get("name") or (tc.get("function") or {}).get("name")
                if name != "generate_structured_output":
                    continue
                args = tc.get("args") or (tc.get("function") or {}).get("arguments") or {}
                if isinstance(args, dict):
                    prompt = str(args.get("prompt") or "").strip()
                break

            forced = [
                _forced_tool_call(
                    "generate_structured_output",
                    {
                        "prompt": _augment_storyboard_prompt(prompt or fallback_prompt),
                        "output_schema": SCRIPT_WRITER_OUTPUT_SCHEMA,
                        "response_format": "json",
                    },
                )
            ]
            updated_ai = last_ai.model_copy(update={"tool_calls": forced})
            return {"messages": [updated_ai]}

        if not has_any_tool_call:
            forced = [
                _forced_tool_call(
                    "generate_structured_output",
                    {
                        "prompt": _augment_storyboard_prompt(fallback_prompt),
                        "output_schema": SCRIPT_WRITER_OUTPUT_SCHEMA,
                        "response_format": "json",
                    },
                )
            ]
            updated_ai = last_ai.model_copy(update={"tool_calls": forced})
            return {"messages": [updated_ai]}

        return update

    last_ai: AIMessage | None = None
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            last_ai = m
            break

    if last_execute_idx is not None and last_execute_idx > last_structured_idx and last_execute_ok:
        if last_ai is None:
            return update
        if last_ai.tool_calls:
            updated_ai = last_ai.model_copy(
                update={
                    "tool_calls": [],
                    "content": "Storyboard batch complete. Script/world/video assets were generated and added to the timeline.",
                }
            )
            return {"messages": [updated_ai]}
        return update

    if last_execute_idx is not None and last_execute_idx > last_structured_idx:
        return update

    if last_ai is None:
        return update

    existing_calls = list(last_ai.tool_calls or [])
    for idx, tool_call in enumerate(existing_calls):
        if _tool_call_name(tool_call) != "generate_structured_output":
            continue
        args = tool_call.get("args")
        if not isinstance(args, dict):
            continue
        original_prompt = str(args.get("prompt") or "").strip()
        augmented_prompt = _augment_storyboard_prompt(original_prompt)
        if augmented_prompt == original_prompt:
            continue
        updated_calls = list(existing_calls)
        updated_calls[idx] = {
            **tool_call,
            "args": {
                **args,
                "prompt": augmented_prompt,
            },
        }
        updated_ai = last_ai.model_copy(update={"tool_calls": updated_calls})
        return {"messages": [updated_ai]}

    existing_calls = list(last_ai.tool_calls or [])
    if any((tc.get("name") or (tc.get("function") or {}).get("name")) == "execute_storyboard" for tc in existing_calls):
        return update

    forced = [_forced_tool_call("execute_storyboard", {})]
    updated_ai = last_ai.model_copy(update={"tool_calls": forced})
    return {"messages": [updated_ai]}


def planner_post_model_hook(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Planner-specific hook:
    - Keep tool execution sequential (same as enforce_single_pending_tool_call)
    - If a storyboard JSON exists (from generate_structured_output) and hasn't been executed yet,
      force the next tool call to be `execute_storyboard` instead of letting the model transfer
      to image/video agents prematurely.
    - After `execute_storyboard` has completed for the latest user request, prevent the planner
      from triggering another batch automatically (stop after one batch unless the user speaks again).
    """
    original_messages: List[Any] = state.get("messages", [])
    if not original_messages:
        return {}

    original_last_ai: AIMessage | None = None
    for m in reversed(original_messages):
        if isinstance(m, AIMessage):
            original_last_ai = m
            break

    resume_update = _force_resume_tool_call(
        state,
        original_messages,
        allowed_tools={"execute_storyboard", "write_plan", "recommend_generation_strategy", "analyze_timeline_state"},
    )
    if resume_update:
        return resume_update

    resume_handoff = _force_resume_handoff(state, original_messages)
    if resume_handoff:
        return resume_handoff

    if original_last_ai is not None and original_last_ai.tool_calls and _is_fresh_request_without_generation_context(state, original_messages):
        filtered_calls = [
            tool_call
            for tool_call in list(original_last_ai.tool_calls or [])
            if _tool_call_name(tool_call) not in {"analyze_timeline_state", "recommend_generation_strategy"}
        ]
        if filtered_calls and len(filtered_calls) != len(list(original_last_ai.tool_calls or [])):
            chosen_call = None
            for tool_call in filtered_calls:
                if not _is_handoff_tool(_tool_call_name(tool_call)):
                    chosen_call = tool_call
                    break
            if chosen_call is None:
                chosen_call = filtered_calls[0]
            updated_ai = original_last_ai.model_copy(update={"tool_calls": [chosen_call]})
            return {"messages": [updated_ai]}

    update = enforce_single_pending_tool_call(state) or {}
    messages: List[Any] = (update.get("messages") or original_messages or [])
    if not messages:
        return update

    last_ai: AIMessage | None = None
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            last_ai = m
            break

    last_user_idx: int | None = None
    for i, m in enumerate(messages):
        if isinstance(m, HumanMessage):
            last_user_idx = i

    last_structured_idx: int | None = None
    for i, m in enumerate(messages):
        if isinstance(m, ToolMessage) and getattr(m, "name", None) == "generate_structured_output":
            if _looks_like_storyboard_json(getattr(m, "content", "")):
                last_structured_idx = i

    last_execute_idx: int | None = None
    last_execute_ok = False
    for i, m in enumerate(messages):
        if isinstance(m, ToolMessage) and getattr(m, "name", None) == "execute_storyboard":
            last_execute_idx = i
            content = getattr(m, "content", "") or ""
            last_execute_ok = isinstance(content, str) and "execute_storyboard completed:" in content

    # If execute_storyboard has completed and there is no newer user message, stop auto tool chains.
    if last_execute_idx is not None and last_execute_ok and (last_user_idx is None or last_execute_idx > last_user_idx):
        if last_ai is None:
            return update

        if last_ai.tool_calls:
            updated_ai = last_ai.model_copy(
                update={
                    "tool_calls": [],
                    "content": (
                        "Batch complete. World/script/video assets for the latest storyboard were generated and added to the timeline. "
                        "Reply with a new request (or 'continue') to start another batch."
                    ),
                }
            )
            return {"messages": [updated_ai]}
        return update

    if last_structured_idx is None:
        return update

    # If execute_storyboard already happened after the latest structured output, do nothing.
    for m in messages[last_structured_idx + 1 :]:
        if isinstance(m, ToolMessage) and getattr(m, "name", None) == "execute_storyboard":
            return update

    if last_ai is None:
        return update

    existing_calls = list(last_ai.tool_calls or [])
    if any((tc.get("name") or (tc.get("function") or {}).get("name")) == "execute_storyboard" for tc in existing_calls):
        return update

    forced = [_forced_tool_call("execute_storyboard", {})]
    updated_ai = last_ai.model_copy(update={"tool_calls": forced})
    return {"messages": [updated_ai]}


def enforce_single_pending_tool_call(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ensure at most one *pending* tool call exists on the last AIMessage.

    We keep tool calls that already have ToolMessages, but we reduce multiple pending
    tool calls to a single one to avoid parallel execution races (especially with handoff).
    """
    messages: List[Any] = state.get("messages", [])
    if not messages:
        return {}

    executed: Set[str] = set()
    for m in messages:
        if isinstance(m, ToolMessage) and getattr(m, "tool_call_id", None):
            executed.add(m.tool_call_id)

    last_ai: AIMessage | None = None
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            last_ai = m
            break

    if last_ai is None or not last_ai.tool_calls or len(last_ai.tool_calls) <= 1:
        return {}

    tool_calls = list(last_ai.tool_calls)
    pending = [tc for tc in tool_calls if tc.get("id") not in executed]
    if len(pending) <= 1:
        return {}

    # Prefer executing a non-handoff tool first; handoff can interrupt other tools.
    chosen = None
    for tc in pending:
        name = tc.get("name") or (tc.get("function") or {}).get("name")
        if not _is_handoff_tool(name):
            chosen = tc
            break
    if chosen is None:
        chosen = pending[0]

    kept: List[dict] = [tc for tc in tool_calls if tc.get("id") in executed]
    kept.append(chosen)

    updated_ai = last_ai.model_copy(update={"tool_calls": kept})
    return {"messages": [updated_ai]}
