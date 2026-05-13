from abc import ABC, abstractmethod
from typing import Optional, Tuple
import base64
import uuid
from io import BytesIO
from PIL import Image
import boto3

from services.config_service import config_service
from utils.http_client import HttpClient


class ImageGenerator(ABC):
    @abstractmethod
    async def generate(
        self,
        prompt: str,
        model: str,
        aspect_ratio: str = "1:1",
        input_image: Optional[str] = None,
        **kwargs
    ) -> Tuple[str, int, int, str]:
        pass


class MissingProviderConfigurationError(RuntimeError):
    """Raised when required provider configuration is missing and retrying is pointless."""

    pass


def generate_image_id():
    return str(uuid.uuid4())


def _get_r2_client():
    r2_config = config_service.get_service_config('r2_storage') or {}
    account_id = str(r2_config.get('account_id') or '').strip()
    access_key_id = str(r2_config.get('access_key_id') or '').strip()
    secret_access_key = str(r2_config.get('secret_access_key') or '').strip()
    bucket_name = str(r2_config.get('bucket_name') or '').strip()
    public_url = str(r2_config.get('public_url') or '').strip().rstrip('/')

    if not all([account_id, access_key_id, secret_access_key, bucket_name, public_url]):
        raise RuntimeError('r2_storage config is incomplete')

    client = boto3.client(
        's3',
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name='auto',
    )
    return client, bucket_name, public_url


def has_r2_storage() -> bool:
    r2_config = config_service.get_service_config('r2_storage') or {}
    account_id = str(r2_config.get('account_id') or '').strip()
    access_key_id = str(r2_config.get('access_key_id') or '').strip()
    secret_access_key = str(r2_config.get('secret_access_key') or '').strip()
    bucket_name = str(r2_config.get('bucket_name') or '').strip()
    public_url = str(r2_config.get('public_url') or '').strip().rstrip('/')
    return all([account_id, access_key_id, secret_access_key, bucket_name, public_url])


async def get_image_info_and_save(url, file_path_without_extension=None, is_b64=False):
    if not url:
        raise ValueError("URL cannot be None or empty")

    if is_b64:
        image_content = base64.b64decode(url)
    else:
        async with HttpClient.create() as client:
            response = await client.get(url)
            image_content = response.content

    image = Image.open(BytesIO(image_content))
    mime_type = Image.MIME.get(image.format if image.format else 'PNG', 'image/png')
    width, height = image.size
    public_url = upload_image_to_r2(image_content, mime_type) if has_r2_storage() else url
    return mime_type, width, height, public_url


def upload_image_to_r2(image_content, mime_type, filename=None):
    client, bucket_name, public_url = _get_r2_client()

    extension_map = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
    }
    extension = extension_map.get(mime_type, '.png')
    key_name = filename or f"gen_image_task/{generate_image_id()}{extension}"

    client.put_object(
        Bucket=bucket_name,
        Key=key_name,
        Body=image_content,
        ContentType=mime_type,
    )
    return f"{public_url}/{key_name}"
