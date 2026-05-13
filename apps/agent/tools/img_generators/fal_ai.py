from typing import Optional
import os
import traceback
import fal_client
from .base import ImageGenerator, MissingProviderConfigurationError, get_image_info_and_save, generate_image_id
from services.config_service import config_service
from fal_client.client import FalClientError


class FalAIGenerator(ImageGenerator):
    """fal.ai image generator implementation"""

    SUPPORTED_EXTRA_INPUT_KEYS = {
        "sync_mode",
        "seed",
        "safety_tolerance",
        "quality",
        "num_images",
        "output_format",
        "openai_api_key",
        "mask_url",
        "mask_image_url",
    }

    def _resolve_api_key(self) -> str:
        """Resolve fal.ai API key from env first, then config."""
        return (
            os.environ.get('REELMIND_FAL_KEY', '').strip()
            or os.environ.get('FAL_KEY', '').strip()
            or config_service.app_config.get('fal_ai', {}).get('api_key', '').strip()
        )

    def __init__(self):
        """Initialize fal.ai generator with API key configuration"""
        api_key = self._resolve_api_key()
        if api_key:
            os.environ['FAL_KEY'] = api_key

    def _validate_aspect_ratio(self, aspect_ratio: str) -> str:
        """
        Validate and normalize aspect ratio for fal.ai

        Args:
            aspect_ratio: Aspect ratio in format like "1:1", "16:9", "9:16"

        Returns:
            Valid fal.ai aspect_ratio string
        """
        # fal.ai supports these aspect ratios directly
        valid_ratios = [
            "21:9", "16:9", "4:3", "3:2", "1:1",
            "2:3", "3:4", "9:16", "9:21"
        ]

        if aspect_ratio in valid_ratios:
            return aspect_ratio

        # Map common variations to supported ratios
        ratio_map = {
            "2.39:1": "21:9",
            "2.35:1": "21:9",
            "landscape": "16:9",
            "portrait": "9:16",
            "square": "1:1"
        }

        return ratio_map.get(aspect_ratio, "1:1")

    def _build_image_size(self, aspect_ratio: str, *, is_edit: bool):
        normalized = self._validate_aspect_ratio(aspect_ratio)
        if is_edit and normalized == "1:1":
            return "auto"

        preset_map = {
            "1:1": "square_hd",
            "16:9": "landscape_16_9",
            "4:3": "landscape_4_3",
            "9:16": "portrait_16_9",
            "3:4": "portrait_4_3",
        }
        if normalized in preset_map:
            return preset_map[normalized]

        custom_map = {
            "21:9": {"width": 1344, "height": 576},
            "2.39:1": {"width": 1344, "height": 560},
        }
        return custom_map.get(normalized, "auto" if is_edit else "square_hd")

    def _candidate_models(self, model: str, *, is_edit: bool) -> list[str]:
        raw = str(model or "").strip()
        candidates: list[str] = []

        def add(value: str):
            normalized = str(value or "").strip()
            if normalized and normalized not in candidates:
                candidates.append(normalized)

        if is_edit:
            if raw.endswith("/edit") or raw.endswith("/image-to-image"):
                add(raw)
            elif raw:
                add(f"{raw}/edit")
                add(f"{raw}/image-to-image")
            add("openai/gpt-image-2/edit")
            add("fal-ai/gpt-image-2/image-to-image")
        else:
            if raw and not raw.endswith("/edit") and not raw.endswith("/image-to-image"):
                add(raw)
            add("openai/gpt-image-2")
            add("fal-ai/gpt-image-2")

        return candidates

    async def generate(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "1:1",
        input_image: Optional[str] = None,
        **kwargs
    ) -> tuple[str, int, int, str]:
        try:
            api_key = self._resolve_api_key()
            if not api_key:
                raise MissingProviderConfigurationError(
                    "Image layer is unavailable. Add an Image API key in Runtime Keys before retrying."
                )

            # Set API key for fal_client
            os.environ['FAL_KEY'] = api_key

            is_edit = bool(input_image)
            image_size = self._build_image_size(aspect_ratio, is_edit=is_edit)

            # Prepare arguments for fal.ai
            arguments = {
                "prompt": prompt,
                "image_size": image_size,
                "num_images": 1,  # Generate single image
                "quality": "high",
                "output_format": "png",
            }

            # Handle input image if provided
            if input_image:
                if input_image.startswith(('http://', 'https://')):
                    arguments["image_urls"] = [input_image]
                else:
                    try:
                        uploaded_url = await fal_client.upload_file_async(input_image)
                        arguments["image_urls"] = [uploaded_url]
                    except Exception as upload_error:
                        print(f"Warning: Failed to upload input image: {upload_error}")
                if "image_urls" not in arguments:
                    raise ValueError("Image editing failed: input image could not be resolved to a public URL")

            for key in self.SUPPORTED_EXTRA_INPUT_KEYS:
                value = kwargs.get(key)
                if value is not None:
                    arguments[key] = value

            model_candidates = self._candidate_models(model, is_edit=is_edit)
            print(f'🦄 fal.ai API request - Models: {model_candidates}, Arguments: {arguments}')

            result = None
            last_error: Exception | None = None
            for candidate in model_candidates:
                try:
                    result = await fal_client.subscribe_async(
                        candidate,
                        arguments=arguments,
                        with_logs=True,
                        on_queue_update=lambda update: print(f"🦄 fal.ai queue update: {update}")
                    )
                    print(f'🦄 fal.ai API response ({candidate}): {result}')
                    break
                except Exception as exc:
                    last_error = exc
                    print(f'🦄 fal.ai request failed for {candidate}: {exc}')
                    if getattr(exc, "status_code", None) == 404:
                        continue
                    raise

            if result is None:
                raise last_error or FalClientError("fal.ai image generation failed without a response")

            # Extract image URL from result
            output_url = None
            if isinstance(result, dict):
                # Try different possible response formats
                if 'images' in result and len(result['images']) > 0:
                    # Format: {"images": [{"url": "..."}]}
                    output_url = result['images'][0].get('url')
                elif 'image' in result:
                    # Format: {"image": {"url": "..."}} or {"image": "url"}
                    if isinstance(result['image'], dict):
                        output_url = result['image'].get('url')
                    else:
                        output_url = result['image']
                elif 'url' in result:
                    # Format: {"url": "..."}
                    output_url = result['url']
                elif 'output' in result:
                    # Format: {"output": "url"} or {"output": [{"url": "..."}]}
                    if isinstance(result['output'], list) and len(result['output']) > 0:
                        if isinstance(result['output'][0], dict):
                            output_url = result['output'][0].get('url')
                        else:
                            output_url = result['output'][0]
                    elif isinstance(result['output'], str):
                        output_url = result['output']

            if not output_url:
                raise Exception(f'fal.ai image generation failed: no output URL found. Response: {result}')

            # Generate unique image ID
            image_id = generate_image_id()
            print('🦄 fal.ai image generation image_id:', image_id)

            # Upload to reelmind.server using existing infrastructure
            mime_type, width, height, public_url = await get_image_info_and_save(
                output_url, None  # No longer need local file path
            )
            
            return mime_type, width, height, public_url

        except Exception as e:
            print('Error generating image with fal.ai:', e)
            traceback.print_exc()
            raise e
