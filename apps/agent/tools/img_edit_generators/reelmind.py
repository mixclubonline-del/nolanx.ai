from typing import Optional
import asyncio
import traceback
from .base import ImageEditGenerator, generate_image_id
from services.config_service import config_service
from utils.http_client import HttpClient


class ReelMindImageEditGenerator(ImageEditGenerator):
    """ReelMind server image edit generator implementation"""

    def __init__(self):
        """Initialize ReelMind image edit generator with server configuration"""
        # Get reelmind.server configuration from config.toml
        self.base_url = config_service.get_reelmind_server_url()
        self.api_key = config_service.get_internal_api_key()
        self.api_endpoint = f"{self.base_url}/agent-generation/image-edit"

    async def edit(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "1:1",
        input_image: str = None,
        input_images: Optional[list[str]] = None,
        **kwargs
    ) -> tuple[str, int, int, str]:
        """
        Edit an image using reelmind.server's image-edit endpoint.
        
        Args:
            prompt: Text description of desired changes
            model: Model identifier (ignored - uses fal-ai/flux-pro/kontext)
            aspect_ratio: Desired aspect ratio
            input_image: URL of the image to edit (required)
            input_images: Optional list of additional reference image URLs
            **kwargs: Additional parameters including user_id
            
        Returns:
            Tuple of (mime_type, width, height, public_url)
        """
        try:
            # Support multi-reference editing: choose a primary input_image, and optionally pass input_images.
            resolved_inputs: list[str] = []
            if isinstance(input_images, list):
                for u in input_images:
                    if isinstance(u, str) and u.strip():
                        resolved_inputs.append(u.strip())

            if isinstance(input_image, str) and input_image.strip():
                input_image = input_image.strip()
                resolved_inputs = [input_image] + [u for u in resolved_inputs if u != input_image]
            elif resolved_inputs:
                input_image = resolved_inputs[0]
            else:
                raise ValueError("Input image URL is required for image editing")

            # De-duplicate while preserving order.
            seen: set[str] = set()
            deduped: list[str] = []
            for u in resolved_inputs:
                if not u or u in seen:
                    continue
                seen.add(u)
                deduped.append(u)
            resolved_inputs = deduped

            # Keep the payload reasonably sized.
            max_refs = int(kwargs.get("max_input_images") or 6)
            if max_refs > 0 and len(resolved_inputs) > max_refs:
                resolved_inputs = resolved_inputs[:max_refs]
            
            # Get user_id from kwargs or use a default
            user_id = kwargs.get('user_id', 'agent-user')
            request_id = kwargs.get("request_id") or kwargs.get("tool_call_id") or generate_image_id()
            
            # Prepare request payload variants. Multi-reference editing is preferred, but
            # reelmind.server may still fail internally on some reference packs; fall back
            # to progressively simpler payloads instead of failing the whole workflow.
            base_payload = {
                "request_id": request_id,
                "user_id": user_id,
                "prompt": prompt,
                "input_image": input_image,
                "aspect_ratio": aspect_ratio,
            }

            payload_variants: list[tuple[str, dict]] = []
            if resolved_inputs:
                payload_variants.append(
                    (
                        "multi_reference" if len(resolved_inputs) > 1 else "single_reference_array",
                        {
                            **base_payload,
                            "input_images": resolved_inputs,
                        },
                    )
                )

            primary_only_refs = [input_image] if input_image else []
            if primary_only_refs != resolved_inputs:
                payload_variants.append(
                    (
                        "primary_only_array",
                        {
                            **base_payload,
                            "input_images": primary_only_refs,
                        },
                    )
                )

            payload_variants.append(("primary_only", dict(base_payload)))

            # Add optional parameters
            if kwargs.get('seed'):
                seed = int(kwargs['seed'])
                for _, payload in payload_variants:
                    payload["seed"] = seed
                
            if kwargs.get('guidance_scale'):
                guidance_scale = float(kwargs['guidance_scale'])
                for _, payload in payload_variants:
                    payload["guidance_scale"] = guidance_scale

            # Make API request to reelmind.server
            headers = {
                "Content-Type": "application/json",
                "X-API-Key": self.api_key  # Add API key for authentication
            }

            async with HttpClient.create_async_client(url=self.api_endpoint) as client:
                max_attempts = int(kwargs.get("max_attempts") or 3)
                last_exc: Exception | None = None
                result = None
                for variant_index, (variant_name, payload) in enumerate(payload_variants, start=1):
                    print(
                        f'🎨 ReelMind Image Edit API request '
                        f'(variant {variant_index}/{len(payload_variants)}: {variant_name}) - Payload: {payload}'
                    )
                    for attempt in range(1, max_attempts + 1):
                        try:
                            response = await client.post(
                                self.api_endpoint,
                                json=payload,
                                headers=headers,
                                timeout=120  # 2 minutes timeout for image editing
                            )

                            if response.status_code != 200:
                                error_text = (await response.aread()).decode("utf-8", errors="replace")
                                print(
                                    f'🎨 ReelMind Image Edit API error '
                                    f'(variant {variant_name}, attempt {attempt}/{max_attempts}): '
                                    f'HTTP {response.status_code}: {error_text}'
                                )

                                retryable = response.status_code in (429, 500, 502, 503, 504)
                                should_fallback = (
                                    response.status_code in (400, 422, 500, 502, 503, 504)
                                    and variant_index < len(payload_variants)
                                )

                                if retryable and attempt < max_attempts:
                                    await asyncio.sleep(0.6 * (2 ** (attempt - 1)))
                                    continue
                                if should_fallback:
                                    last_exc = Exception(
                                        f"ReelMind API error {response.status_code}: {error_text}"
                                    )
                                    print(
                                        f'🎨 Falling back to next image-edit payload variant after '
                                        f'{variant_name} failure'
                                    )
                                    break
                                raise Exception(f"ReelMind API error {response.status_code}: {error_text}")

                            result = response.json()
                            print(f'🎨 ReelMind Image Edit API response: {result}')
                            last_exc = None
                            break
                        except Exception as e:
                            last_exc = e
                            print(
                                f'🎨 ReelMind Image Edit API exception '
                                f'(variant {variant_name}, attempt {attempt}/{max_attempts}): {e}'
                            )
                            if attempt < max_attempts:
                                await asyncio.sleep(0.6 * (2 ** (attempt - 1)))
                                continue
                            if variant_index < len(payload_variants):
                                print(
                                    f'🎨 Falling back to next image-edit payload variant after '
                                    f'exception in {variant_name}'
                                )
                                break
                            raise

                    if result is not None:
                        break

                # Extract data from response - check the nested data structure
                if result is None:
                    raise Exception(f"Image edit failed: no response ({last_exc})")
                data = result.get('data', {})
                if not data.get('success'):
                    raise Exception(f"Image edit failed: {data.get('message', 'Unknown error')}")

                image_url = data.get('url')
                if not image_url:
                    raise Exception("No image URL in response")

                # Return standard format: (mime_type, width, height, public_url)
                # For image editing, we'll use default dimensions since the API doesn't return them
                mime_type = data.get('mime_type', 'image/jpeg')
                
                # Default dimensions - in a real implementation, you might want to 
                # fetch the actual dimensions from the image
                width = 1024
                height = 1024
                
                # Adjust dimensions based on aspect ratio
                if aspect_ratio == "16:9":
                    width, height = 1024, 576
                elif aspect_ratio == "21:9":
                    width, height = 1344, 576
                elif aspect_ratio == "9:16":
                    width, height = 576, 1024
                elif aspect_ratio == "4:3":
                    width, height = 1024, 768
                elif aspect_ratio == "3:4":
                    width, height = 768, 1024
                # Default 1:1 is already set above

                return mime_type, width, height, image_url

        except Exception as e:
            print(f'❌ ReelMind image edit error: {str(e)}')
            print(f'Stack trace: {traceback.format_exc()}')
            raise Exception(f"ReelMind image edit failed: {str(e)}")
