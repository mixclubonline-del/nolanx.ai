from typing import Optional
import asyncio
import traceback
import httpx
from .base import ImageGenerator, generate_image_id
from services.config_service import config_service
from utils.http_client import HttpClient


class ReelMindGenerator(ImageGenerator):
    """ReelMind server image generator implementation"""

    AGENT_IMAGE_HTTP_READ_TIMEOUT_SECONDS = 10 * 60

    def __init__(self):
        """Initialize ReelMind generator with server configuration"""
        # Get reelmind.server configuration from config.toml
        self.base_url = config_service.get_reelmind_server_url()
        self.api_key = config_service.get_internal_api_key()
        self.api_endpoint = f"{self.base_url}/agent-generation/image"

    @staticmethod
    def _extract_image_payload(result: dict) -> tuple[str, str, int | None, int | None, int]:
        """
        Accept both ReelMind wrapped responses and raw fal image responses.

        Supported shapes:
        - {"code": 200, "data": {"success": true, "url": "..."}}
        - {"success": true, "url": "..."}
        - {"images": [{"url": "...", "content_type": "image/png", ...}]}
        - {"data": {"images": [{"url": "..."}]}}
        """
        if not isinstance(result, dict):
            raise Exception(f"ReelMind image generation failed: invalid response type {type(result).__name__}")

        if "code" in result and result.get("code") != 200:
            error_message = result.get("message", "Unknown error")
            raise Exception(f"ReelMind image generation failed: {error_message}")

        data = result.get("data") if isinstance(result.get("data"), dict) else result
        if not isinstance(data, dict):
            raise Exception("ReelMind image generation failed: invalid response data")

        if data.get("success") is False:
            error_message = data.get("message", "Unknown error")
            raise Exception(f"ReelMind image generation failed: {error_message}")

        public_url = data.get("url")
        mime_type = data.get("mime_type") or data.get("content_type") or "image/png"
        width = data.get("width")
        height = data.get("height")

        images = data.get("images")
        if not public_url and isinstance(images, list) and images:
            first = images[0]
            if isinstance(first, dict):
                public_url = first.get("url")
                mime_type = first.get("content_type") or first.get("mime_type") or mime_type
                width = first.get("width")
                height = first.get("height")

        if not public_url:
            raise Exception(f"No URL returned from ReelMind server. Response keys: {sorted(result.keys())}")

        credits = data.get("credits_consumed")
        try:
            credits_consumed = int(credits) if credits is not None else 0
        except Exception:
            credits_consumed = 0

        parsed_width = int(width) if isinstance(width, (int, float)) and width > 0 else None
        parsed_height = int(height) if isinstance(height, (int, float)) and height > 0 else None

        return str(public_url), str(mime_type), parsed_width, parsed_height, credits_consumed

    async def generate(
        self,
        prompt: str,
        model: str = "",
        aspect_ratio: str = "1:1",
        input_image: Optional[str] = None,
        **kwargs
    ) -> tuple[str, int, int, str]:
        """
        Generate image using reelmind.server agent generation API
        
        Args:
            prompt: Text prompt for image generation
            model: Model name (ignored, uses fixed flux-kontext-pro)
            aspect_ratio: Image aspect ratio
            input_image: Optional input image URL
            **kwargs: Additional parameters
            
        Returns:
            Tuple of (mime_type, width, height, public_url)
        """
        try:
            # Get user_id from kwargs or use a default
            user_id = kwargs.get('user_id', 'agent-user')
            request_id = kwargs.get("request_id") or kwargs.get("tool_call_id") or generate_image_id()
            
            # Prepare request payload
            payload = {
                "request_id": request_id,
                "user_id": user_id,
                "prompt": prompt,
                "aspect_ratio": aspect_ratio,
            }
            
            # Add optional parameters
            if input_image:
                payload["input_image"] = input_image
                
            if kwargs.get('seed'):
                payload["seed"] = int(kwargs['seed'])
                
            if kwargs.get('guidance_scale'):
                payload["guidance_scale"] = float(kwargs['guidance_scale'])

            print(f'🦄 ReelMind API request - Payload: {payload}')

            # Make API request to reelmind.server
            headers = {
                "Content-Type": "application/json",
                "X-API-Key": self.api_key  # Add API key for authentication
            }

            image_timeout = httpx.Timeout(
                connect=30.0,
                read=float(kwargs.get("agent_http_read_timeout_seconds", self.AGENT_IMAGE_HTTP_READ_TIMEOUT_SECONDS)),
                write=60.0,
                pool=120.0,
            )

            max_attempts = int(kwargs.get("max_attempts") or 3)
            last_exc: Exception | None = None
            result = None

            for attempt in range(1, max_attempts + 1):
                try:
                    async with HttpClient.create(url=self.api_endpoint, timeout=image_timeout) as client:
                        response = await client.post(
                            self.api_endpoint,
                            headers=headers,
                            json=payload
                        )

                        if response.status_code != 200:
                            error_msg = f"HTTP {response.status_code}: {response.text}"
                            print(f'🦄 ReelMind API error (attempt {attempt}/{max_attempts}): {error_msg}')
                            if response.status_code in (429, 500, 502, 503, 504) and attempt < max_attempts:
                                await asyncio.sleep(0.6 * (2 ** (attempt - 1)))
                                continue
                            raise Exception(f'ReelMind image generation failed: {error_msg}')

                        result = response.json()
                        print(f'🦄 ReelMind API response: {result}')
                        last_exc = None
                        break
                except Exception as e:
                    last_exc = e
                    print(
                        f'🦄 ReelMind API exception (attempt {attempt}/{max_attempts}): '
                        f'{type(e).__name__}: {repr(e)}'
                    )
                    if attempt < max_attempts:
                        await asyncio.sleep(0.6 * (2 ** (attempt - 1)))
                        continue
                    raise

            # Handle response. Depending on whether the Nest response wrapper is active,
            # this may be a ReelMind envelope or a raw fal response.
            if result is None:
                raise Exception(f"ReelMind image generation failed: no response ({last_exc})")

            public_url, mime_type, response_width, response_height, credits_consumed = self._extract_image_payload(result)
            
            # For now, we'll estimate dimensions since the API doesn't return them
            # In a real implementation, you might want to fetch the image to get actual dimensions
            width = response_width or 1024  # Default width
            height = response_height or 1024  # Default height
            
            # Adjust dimensions based on aspect ratio
            if response_width and response_height:
                width, height = response_width, response_height
            elif aspect_ratio == "16:9":
                width, height = 1024, 576
            elif aspect_ratio == "21:9":
                width, height = 1344, 576
            elif aspect_ratio == "9:16":
                width, height = 576, 1024
            elif aspect_ratio == "4:3":
                width, height = 1024, 768
            elif aspect_ratio == "3:4":
                width, height = 768, 1024

            print(f'🦄 ReelMind image generated successfully: {public_url}')
            print(f'🦄 Credits consumed: {credits_consumed}')

            return mime_type, width, height, public_url

        except Exception as e:
            print(f'🦄 ReelMind image generation error: {type(e).__name__}: {repr(e)}')
            traceback.print_exc()
            raise e
