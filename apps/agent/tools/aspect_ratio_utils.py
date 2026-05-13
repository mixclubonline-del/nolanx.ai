"""
Aspect ratio normalization helpers.
"""

from __future__ import annotations


_ALIASES = {
    "2.39:1": "21:9",
    "2.35:1": "21:9",
    "21:9": "21:9",
    "cinematic": "21:9",
    "widescreen": "21:9",
    "vertical": "9:16",
    "portrait": "9:16",
    "landscape": "16:9",
    "standard": "16:9",
}


def normalize_aspect_ratio(value: str | None, default: str = "16:9") -> str:
    raw = str(value or "").strip()
    if not raw:
        return default
    return _ALIASES.get(raw.lower(), raw)


def normalize_storyboard_aspect_ratio(value: str | None, default: str = "16:9") -> str:
    normalized = normalize_aspect_ratio(value, default=default)
    if normalized == "21:9":
        return "2.39:1"
    return normalized


def normalize_generation_aspect_ratio(value: str | None, default: str = "16:9") -> str:
    return normalize_aspect_ratio(value, default=default)
