from abc import ABC, abstractmethod
from typing import Tuple, Optional
import uuid


def generate_image_id():
    """Generate a unique image ID using UUID format"""
    return str(uuid.uuid4())


class ImageEditGenerator(ABC):
    """Abstract base class for image edit generators"""
    
    @abstractmethod
    async def edit(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "1:1",
        input_image: str = None,
        input_images: Optional[list[str]] = None,
        **kwargs
    ) -> Tuple[str, int, int, str]:
        """
        Edit an existing image based on the prompt and input image.
        
        Args:
            prompt: Text description of desired changes
            model: Model identifier (may be ignored by some providers)
            aspect_ratio: Desired aspect ratio
            input_image: URL of the image to edit (required)
            input_images: Optional additional reference images
            **kwargs: Additional provider-specific parameters
            
        Returns:
            Tuple of (mime_type, width, height, public_url)
        """
        pass
