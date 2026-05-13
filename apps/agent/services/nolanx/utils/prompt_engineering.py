"""
Shared prompt-engineering helpers for storyboard/runtime orchestration.

Keep this layer lightweight:
- centralize reusable text rules
- avoid introducing new hard schema requirements
- prefer prompt/runtime guidance over brittle structural constraints
"""

from __future__ import annotations

from typing import Iterable


def _clean_urls(values: Iterable[str] | None, limit: int = 8) -> list[str]:
    clean: list[str] = []
    for value in values or []:
        normalized = str(value or "").strip()
        if not normalized or normalized in clean:
            continue
        clean.append(normalized)
        if len(clean) >= limit:
            break
    return clean


def build_numbered_media_lines(
    *,
    image_urls: Iterable[str] | None = None,
    video_urls: Iterable[str] | None = None,
    audio_urls: Iterable[str] | None = None,
    user_wants_self_insert: bool = False,
) -> list[str]:
    clean_images = _clean_urls(image_urls)
    clean_videos = _clean_urls(video_urls)
    clean_audios = _clean_urls(audio_urls)
    if not clean_images and not clean_videos and not clean_audios:
        return []

    lines = ["RUNTIME MEDIA CONTEXT:"]
    if clean_images:
        lines.append("Uploaded images with explicit numbering:")
        lines.extend(f"- 图{idx} = {url}" for idx, url in enumerate(clean_images, start=1))
    if clean_videos:
        lines.append("Uploaded videos with explicit numbering:")
        lines.extend(f"- 视频{idx} = {url}" for idx, url in enumerate(clean_videos, start=1))
    if clean_audios:
        lines.append("Uploaded audio with explicit numbering:")
        lines.extend(f"- 音频{idx} = {url}" for idx, url in enumerate(clean_audios, start=1))
    if user_wants_self_insert and clean_images:
        lines.append(
            "Treat uploaded images as identity anchors for the primary on-screen character and preserve face/look continuity across planning and execution."
        )
    lines.append("Do not infer semantic identity from raw asset ids; bind references through explicit 图N/视频N/音频N mappings only.")
    return lines


def seedance_prompt_engineering_rules() -> list[str]:
    return [
        "Use Seedance-style engineered prompting: subject, action, environment, camera/editing, style, audio, then constraints.",
        "Write shots on a time axis with explicit beat progression instead of one unstructured block of prose.",
        "Keep camera instructions concrete and sparse; prefer one dominant move per beat unless a motivated cut is clearly needed.",
        "For multimodal references, assign explicit roles instead of guessing: image locks identity/look, video locks motion/camera rhythm, audio locks rhythm/mood.",
        "When multiple people are present, disambiguate each person explicitly and avoid relying on implicit naming or raw asset ids.",
        "If dialogue exists, keep it short enough to be fully performed within the clip and let reactions / pickups / interruptions motivate the cut structure.",
        "For nine-grid or storyboard-style references, bind each image to the relevant beat instead of asking the model to infer the full sequence from one dense paragraph.",
    ]
