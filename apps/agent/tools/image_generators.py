import traceback
from typing import Optional, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.runnables import RunnableConfig

from services.api_client_service import api_client_service
from services.websocket_service import send_session_update
from services.config_service import config_service
from services.nolanx.runtime_capabilities import get_runtime_capability_flags
from .img_generators import FalAIGenerator, MissingProviderConfigurationError
from .aspect_ratio_utils import normalize_generation_aspect_ratio
from .timeline_utils import build_review_event_from_asset, generate_file_id, create_keyframe_asset


class GenerateImageInputSchema(BaseModel):
    prompt: str = Field(description="Required. Describe the image you want to create or edit.")
    aspect_ratio: str = Field(description="Required. Aspect ratio of the image.")
    input_image: Optional[str] = Field(default=None, description="Optional input image URL for editing.")
    tool_call_id: Annotated[str, InjectedToolCallId]


PROVIDERS = {
    'fal_ai': FalAIGenerator(),
}


@tool(
    "generate_image",
    description="Generate an image using text prompt or optionally pass an image for reference or editing",
    args_schema=GenerateImageInputSchema,
)
async def generate_image(
    prompt: str,
    aspect_ratio: str,
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    input_image: Optional[str] = None,
) -> str:
    if config is None:
        raise ValueError("Config parameter is None")

    ctx = config.get('configurable', {})
    canvas_id = ctx.get('canvas_id', '')
    session_id = ctx.get('session_id', '')
    user_id = ctx.get('user_id', '')
    ctx['tool_call_id'] = tool_call_id

    provider = 'fal_ai'
    provider_config = config_service.get_service_config('fal_ai') or {}
    model = provider_config.get('image_edit_model') if input_image else provider_config.get('image_model')
    model = model or ('openai/gpt-image-2' if input_image else 'openai/gpt-image-2')
    aspect_ratio = normalize_generation_aspect_ratio(aspect_ratio, default="1:1")

    generator = PROVIDERS.get(provider)
    if not generator:
        raise ValueError(f"Unsupported provider: {provider}")

    if not get_runtime_capability_flags().get("image_ready"):
        message = "image generation unavailable: add an Image API key in Runtime Keys before retrying."
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': message,
        })
        return message

    try:
        mime_type, width, height, public_url = await generator.generate(
            prompt=prompt,
            model=model,
            aspect_ratio=aspect_ratio,
            input_image=input_image,
            user_id=user_id,
            tool_call_id=tool_call_id,
        )

        file_id = generate_file_id()
        keyframe_asset = create_keyframe_asset(
            file_id=file_id,
            public_url=public_url,
            width=width,
            height=height,
            mime_type=mime_type,
            prompt=prompt,
            duration=8,
        )

        await api_client_service.add_timeline_asset(
            canvas_id=canvas_id,
            asset_type='keyframe',
            asset_data=keyframe_asset,
            user_id=user_id,
        )

        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'image_generated',
            'asset': keyframe_asset,
            'image_url': public_url,
            'tool_name': 'generate_image',
        })
        review_event = build_review_event_from_asset(keyframe_asset)
        if review_event:
            await send_session_update(user_id, session_id, canvas_id, review_event)

        return f"image generated successfully ![image_url: {public_url}]({public_url})"
    except MissingProviderConfigurationError:
        message = "image generation unavailable: add an Image API key in Runtime Keys before retrying."
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': message,
        })
        return message
    except Exception as e:
        error_text = f"{type(e).__name__}: {str(e) or repr(e)}"
        print(f"Error generating image: {error_text}")
        traceback.print_exc()
        await send_session_update(user_id, session_id, canvas_id, {
            'type': 'error',
            'error': error_text,
        })
        return f"image generation failed: {error_text}"


print('🛠️', generate_image.args_schema.model_json_schema())
