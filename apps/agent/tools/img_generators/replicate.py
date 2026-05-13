from typing import Optional
import os
import traceback
from .base import ImageGenerator, get_image_info_and_save, generate_image_id
from services.config_service import config_service
from utils.http_client import HttpClient


class ReplicateGenerator(ImageGenerator):
    """Replicate image generator implementation"""

    async def generate(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "match_input_image",
        input_image: Optional[str] = None,
        **kwargs
    ) -> tuple[str, int, int, str]:
        try:
            api_key = config_service.app_config.get(
                'replicate', {}).get('api_key', '')
            if not api_key:
                raise ValueError(
                    "Image generation failed: Replicate API key is not set")

            url = f"https://api.replicate.com/v1/models/{model}/predictions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Prefer": "wait"
            }
            data = {
                "input": {
                    "prompt": prompt,
                    "aspect_ratio": aspect_ratio,
                    "safety_tolerance": 6,
                }
            }

            if input_image:
                data['input']['input_image'] = input_image
                model = 'black-forest-labs/flux-kontext-pro'

            async with HttpClient.create() as client:
                response = await client.post(url, headers=headers, json=data)
                res = response.json()

            print(f'🦄 Replicate API response: {res}')  # Debug log

            output = res.get('output', '')
            if not output:  # Check for both None and empty string
                if res.get('detail', '') != '':
                    raise Exception(
                        f'Replicate image generation failed: {res.get("detail", "")}')
                else:
                    raise Exception(
                        f'Replicate image generation failed: no output url found. Response: {res}')

            image_id = generate_image_id()
            print('🦄image generation image_id', image_id)

            # Upload to reelmind.server instead of saving locally
            mime_type, width, height, public_url = await get_image_info_and_save(
                output, None  # No longer need local file path
            )
            return mime_type, width, height, public_url

        except Exception as e:
            print('Error generating image with replicate', e)
            traceback.print_exc()
            raise e
