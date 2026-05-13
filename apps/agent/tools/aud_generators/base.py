from abc import ABC, abstractmethod
from typing import Optional, Tuple
import uuid
import tempfile
import aiohttp
from utils.http_client import HttpClient


class AudioGenerator(ABC):
    """Abstract base class for audio generators"""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        model: str,
        audio_type: str = "tts",  # "tts" for text-to-speech, "sound_effects" for sound effects
        voice: Optional[str] = None,  # Voice ID for TTS
        **kwargs
    ) -> Tuple[str, str]:
        """
        Generate audio and return metadata

        Args:
            prompt: Text prompt for audio generation
            model: Model name/identifier
            audio_type: Type of audio generation ("tts" or "sound_effects")
            voice: Voice ID for TTS (optional)
            **kwargs: Additional provider-specific parameters

        Returns:
            Tuple of (mime_type, public_url)
        """
        pass


def generate_audio_id():
    """Generate unique audio ID using UUID format"""
    return str(uuid.uuid4())