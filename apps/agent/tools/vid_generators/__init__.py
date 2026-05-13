from .base import VideoGenerator
# from .fal_ai import FalAIVideoGenerator
from .reelmind import ReelMindVideoGenerator

try:
    from .gemini_veo import GeminiVeoVideoGenerator
except Exception:  # pragma: no cover - local OSS mode may not have Gemini configured
    GeminiVeoVideoGenerator = None

__all__ = [
    'VideoGenerator',
    # 'FalAIVideoGenerator',
    'ReelMindVideoGenerator',
    'GeminiVeoVideoGenerator',
]
