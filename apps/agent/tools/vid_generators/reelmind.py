from typing import Any, Optional, Tuple
import asyncio
import hashlib
import json
import httpx
from services.config_service import config_service
from services.runtime_logger import log_runtime_warning
from utils.http_client import HttpClient
from ..aspect_ratio_utils import normalize_generation_aspect_ratio


class ReelMindVideoGenerator:
    DEFAULT_MODEL_ID = "dreamina-seedance-2-0-260128"
    DEFAULT_DURATION_SECONDS = 15
    MAX_PROMPT_CHARS = 2500
    MAX_REFERENCE_IMAGES = 9
    MAX_REFERENCE_VIDEOS = 3
    MAX_REFERENCE_AUDIOS = 3
    POLL_INTERVAL_SECONDS = 4
    POLL_MAX_ATTEMPTS = 180

    def __init__(self):
        cfg = config_service.get_service_config('reelmind') or {}
        self.api_key = str(cfg.get('api_key') or '').strip()
        self.api_endpoint = str(cfg.get('endpoint') or 'https://nestapi.reelmind.ai/external-api/video/generate').strip()
        self.task_endpoint_base = str(cfg.get('task_endpoint_base') or 'https://nestapi.reelmind.ai/external-api/video/task').strip().rstrip('/')
        self.default_model_id = str(cfg.get('model') or self.DEFAULT_MODEL_ID).strip() or self.DEFAULT_MODEL_ID

    @staticmethod
    def _dedupe_urls(urls: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for url in urls:
            if not isinstance(url, str):
                continue
            normalized = url.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    @classmethod
    def _sanitize_prompt(cls, prompt: str) -> str:
        normalized = " ".join(str(prompt or "").split()).strip()
        if len(normalized) <= cls.MAX_PROMPT_CHARS:
            return normalized
        return normalized[: cls.MAX_PROMPT_CHARS - 3].rstrip() + "..."

    @staticmethod
    def _normalize_frames(frames: Any) -> Optional[int]:
        try:
            numeric = int(frames)
        except Exception:
            return None
        return numeric if numeric > 0 else None

    def _extract_video_url(self, payload: Any) -> Optional[str]:
        if isinstance(payload, str) and payload.startswith('http'):
            return payload
        if isinstance(payload, dict):
            candidates = [
                payload.get('video_url'),
                payload.get('url'),
                payload.get('output_url'),
                payload.get('result_url'),
            ]
            for candidate in candidates:
                if isinstance(candidate, str) and candidate.startswith('http'):
                    return candidate
            data = payload.get('data')
            if isinstance(data, dict):
                return self._extract_video_url(data)
            result = payload.get('result')
            if isinstance(result, dict):
                return self._extract_video_url(result)
            videos = payload.get('videos')
            if isinstance(videos, list) and videos:
                first = videos[0]
                if isinstance(first, dict):
                    return self._extract_video_url(first)
                if isinstance(first, str) and first.startswith('http'):
                    return first
        return None

    def _extract_task_id(self, payload: Any) -> Optional[str]:
        if isinstance(payload, dict):
            for key in ('task_id', 'id'):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            data = payload.get('data')
            if isinstance(data, dict):
                return self._extract_task_id(data)
        return None

    def _is_terminal_failure(self, payload: Any) -> tuple[bool, str]:
        if not isinstance(payload, dict):
            return False, ''
        status = str(payload.get('status') or payload.get('state') or '').lower()
        if status in {'failed', 'error', 'cancelled'}:
            return True, str(payload.get('message') or payload.get('error') or status)
        data = payload.get('data')
        if isinstance(data, dict):
            return self._is_terminal_failure(data)
        return False, ''

    async def _poll_task_result(self, task_id: str) -> str:
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
        }
        timeout = httpx.Timeout(connect=30.0, read=60.0, write=60.0, pool=120.0)
        url = f"{self.task_endpoint_base}/{task_id}"

        for attempt in range(1, self.POLL_MAX_ATTEMPTS + 1):
            async with HttpClient.create(url=url, timeout=timeout) as client:
                response = await client.get(url, headers=headers)
                if response.status_code >= 400:
                    raise Exception(f"ReelMind task polling failed: HTTP {response.status_code}: {response.text}")
                result = response.json()

            video_url = self._extract_video_url(result)
            if video_url:
                return video_url

            failed, message = self._is_terminal_failure(result)
            if failed:
                raise Exception(f"ReelMind task failed: {message}")

            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

        raise Exception(f"ReelMind task timed out after {self.POLL_MAX_ATTEMPTS} attempts: {task_id}")

    async def generate(
        self,
        prompt: str,
        input_image_url: Optional[str] = None,
        image_urls: Optional[list[str]] = None,
        video_urls: Optional[list[str]] = None,
        audio_urls: Optional[list[str]] = None,
        first_frame_url: Optional[str] = None,
        last_frame_url: Optional[str] = None,
        duration: Optional[int] = None,
        aspect_ratio: Optional[str] = None,
        **kwargs
    ) -> Tuple[str, str] | Tuple[str, str, dict[str, Any]]:
        if not self.api_key:
            raise ValueError('video generation unavailable: add a Video API key in Runtime Keys before retrying.')

        user_id = kwargs.get('user_id', '')
        payload = {
            'model_id': str(kwargs.get('model') or self.default_model_id or self.DEFAULT_MODEL_ID),
            'prompt': self._sanitize_prompt(prompt),
        }

        reference_urls: list[str] = []
        if isinstance(image_urls, list):
            reference_urls.extend(image_urls)
        if input_image_url:
            reference_urls.insert(0, input_image_url)
        if first_frame_url:
            payload['start_image_url'] = first_frame_url
            reference_urls.insert(0, first_frame_url)
        if last_frame_url:
            payload['end_image_url'] = last_frame_url

        reference_urls = self._dedupe_urls(reference_urls)[: self.MAX_REFERENCE_IMAGES]
        if reference_urls:
            payload['image_urls'] = reference_urls

        reference_video_urls = self._dedupe_urls(video_urls or [])[: self.MAX_REFERENCE_VIDEOS]
        if reference_video_urls:
            if len(reference_video_urls) == 1:
                payload['video_url'] = reference_video_urls[0]
            else:
                payload['video_urls'] = reference_video_urls

        reference_audio_urls = self._dedupe_urls(audio_urls or [])[: self.MAX_REFERENCE_AUDIOS]
        if reference_audio_urls:
            payload['audio_urls'] = reference_audio_urls

        frames = self._normalize_frames(kwargs.get('frames'))
        resolved_duration = int(duration) if duration else self.DEFAULT_DURATION_SECONDS
        payload['duration'] = str(resolved_duration)
        if frames is not None:
            payload['frames'] = frames

        payload['aspect_ratio'] = normalize_generation_aspect_ratio(aspect_ratio, default='16:9') if aspect_ratio else '16:9'
        payload['resolution'] = str(kwargs.get('resolution') or '720p')

        request_id = kwargs.get('request_id')
        if not request_id:
            request_seed = {
                'prompt': payload['prompt'],
                'image_urls': payload.get('image_urls') or [],
                'video_url': payload.get('video_url'),
                'video_urls': payload.get('video_urls') or [],
                'audio_urls': payload.get('audio_urls') or [],
                'start_image_url': payload.get('start_image_url'),
                'end_image_url': payload.get('end_image_url'),
                'duration': payload.get('duration'),
                'frames': payload.get('frames'),
                'aspect_ratio': payload.get('aspect_ratio'),
                'user_id': user_id,
            }
            request_id = hashlib.sha256(
                json.dumps(request_seed, ensure_ascii=False, sort_keys=True).encode('utf-8')
            ).hexdigest()[:32]
        payload['request_id'] = request_id

        webhook_url = kwargs.get('webhook_url')
        if webhook_url:
            payload['webhook_url'] = str(webhook_url)

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
        }
        timeout = httpx.Timeout(connect=30.0, read=180.0, write=60.0, pool=120.0)

        request_attempts = 1
        async with HttpClient.create(url=self.api_endpoint, timeout=timeout) as client:
            response = await client.post(self.api_endpoint, headers=headers, json=payload)
            if response.status_code >= 400:
                raise Exception(f"ReelMind video generation failed: HTTP {response.status_code}: {response.text}")
            result = response.json()

        direct_video_url = self._extract_video_url(result)
        if direct_video_url:
            details = {
                'request_id': request_id,
                'request_attempts': request_attempts,
                'provider_video_url': direct_video_url,
                'response': result,
            }
            if kwargs.get('return_details'):
                return 'video/mp4', direct_video_url, details
            return 'video/mp4', direct_video_url

        task_id = self._extract_task_id(result)
        if not task_id:
            failed, message = self._is_terminal_failure(result)
            if failed:
                raise Exception(f"ReelMind video generation failed: {message}")
            raise Exception(f"ReelMind video generation failed: no task_id or result URL returned. Response: {result}")

        log_runtime_warning('video.polling.started', task_id=task_id, provider='reelmind')
        public_url = await self._poll_task_result(task_id)
        details = {
            'request_id': request_id,
            'request_attempts': request_attempts,
            'task_id': task_id,
            'provider_video_url': public_url,
            'response': result,
        }
        if kwargs.get('return_details'):
            return 'video/mp4', public_url, details
        return 'video/mp4', public_url
