from typing import Any, Optional, Tuple
import traceback
import httpx
import hashlib
import json
from .base import VideoGenerator, generate_video_id
from utils.http_client import HttpClient
from services.config_service import config_service
from services.runtime_logger import log_runtime_event, log_runtime_warning
from ..aspect_ratio_utils import normalize_generation_aspect_ratio


class ReelMindVideoGenerator(VideoGenerator):
    """ReelMind server video generator implementation"""

    DEFAULT_MODEL_ID = "dreamina-seedance-2-0-260128"
    DEFAULT_DURATION_SECONDS = 15
    DEFAULT_RESOLUTION = "720p"
    MAX_WORLD_REFERENCE_VIDEOS = 3
    MAX_PROMPT_CHARS = 2500
    MAX_REFERENCE_IMAGES = 9
    MAX_REFERENCE_VIDEOS = MAX_WORLD_REFERENCE_VIDEOS
    MAX_REFERENCE_AUDIOS = 3
    AGENT_VIDEO_HTTP_READ_TIMEOUT_SECONDS = 10 * 60
    AGENT_VIDEO_TRANSPORT_RETRIES = 1
    AGENT_VIDEO_REQUEST_RETRY_LIMIT = 3
    AGENT_VIDEO_FRESH_REQUEST_RETRY_LIMIT = 2
    AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS = 2

    RETRYABLE_ERRORS = (
        httpx.TimeoutException,
        httpx.ReadError,
        httpx.RemoteProtocolError,
        httpx.ProtocolError,
    )

    def __init__(self):
        """Initialize ReelMind video generator with server configuration"""
        # Get reelmind.server configuration from config.toml
        self.base_url = config_service.get_reelmind_server_url()
        self.api_key = config_service.get_internal_api_key()
        self.api_endpoint = f"{self.base_url}/agent-generation/video"

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

    @classmethod
    def _is_request_retryable(cls, error: Exception) -> bool:
        if isinstance(error, cls.RETRYABLE_ERRORS):
            return True
        message = str(error or "").lower()
        retryable_markers = (
            "timed out",
            "timeout",
            "remoteprotocolerror",
            "protocol error",
            "readerror",
            "connecttimeout",
            "temporarily unavailable",
            "connection reset",
            "server disconnected",
        )
        return any(marker in message for marker in retryable_markers)

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
    ) -> Tuple[str, str]:
        """
        Generate video using reelmind.server agent generation API

        Args:
            prompt: Text prompt for video generation
            input_image_url: Legacy primary image URL for single-frame image-to-video generation
            image_urls: Reference image URLs for Kling O3 reference-to-video
            video_urls: Reference video URLs for Seedance 2.0 video-to-video
            audio_urls: Reference audio URLs for multimodal Seedance 2.0 generation
            first_frame_url: URL of the first frame for first-last-frame generation
            last_frame_url: URL of the last frame for first-last-frame generation
            duration: Video duration in seconds (optional)
            aspect_ratio: Video aspect ratio (optional)
            **kwargs: Additional parameters

        Returns:
            Tuple of (mime_type, public_url)
        """
        try:
            # Get user_id from kwargs or use a default
            user_id = kwargs.get('user_id', '')

            # Let reelmind.server choose the canonical agent video model internally.
            # Keep `model_id` as an empty string so the DTO stays valid while the
            # server-side fallback path remains in control.
            payload = {
                "user_id": user_id,
                "prompt": self._sanitize_prompt(prompt),
                "model_id": "",
                "resolution": str(kwargs.get("resolution") or self.DEFAULT_RESOLUTION),
            }

            reference_urls: list[str] = []
            if isinstance(image_urls, list):
                reference_urls.extend(image_urls)
            if input_image_url:
                reference_urls.insert(0, input_image_url)
            if first_frame_url:
                reference_urls.insert(0, first_frame_url)
            reference_urls = self._dedupe_urls(reference_urls)[: self.MAX_REFERENCE_IMAGES]

            if reference_urls:
                payload["image_urls"] = reference_urls

            reference_video_urls = self._dedupe_urls(video_urls or [])[: self.MAX_REFERENCE_VIDEOS]
            if reference_video_urls:
                payload["video_urls"] = reference_video_urls

            reference_audio_urls = self._dedupe_urls(audio_urls or [])[: self.MAX_REFERENCE_AUDIOS]
            if reference_audio_urls:
                payload["audio_urls"] = reference_audio_urls

            # Add frame parameters
            is_flf = bool(first_frame_url and last_frame_url)
            if is_flf:
                payload["first_frame_url"] = first_frame_url
                payload["last_frame_url"] = last_frame_url

            frames = self._normalize_frames(kwargs.get("frames"))
            if duration:
                payload["duration"] = int(duration)
            elif duration is None:
                payload["duration"] = self.DEFAULT_DURATION_SECONDS
            if frames is not None:
                payload["frames"] = frames

            if aspect_ratio:
                payload["aspect_ratio"] = normalize_generation_aspect_ratio(aspect_ratio, default="16:9")
            else:
                payload["aspect_ratio"] = "16:9"  # Default aspect ratio

            if kwargs.get('guidance_scale'):
                payload["guidance_scale"] = float(kwargs['guidance_scale'])

            base_request_id = kwargs.get('request_id')
            if not base_request_id:
                request_seed = {
                    "prompt": payload["prompt"],
                    "image_urls": payload.get("image_urls") or [],
                    "video_urls": payload.get("video_urls") or [],
                    "audio_urls": payload.get("audio_urls") or [],
                    "first_frame_url": payload.get("first_frame_url"),
                    "last_frame_url": payload.get("last_frame_url"),
                    "duration": payload.get("duration"),
                    "frames": payload.get("frames"),
                    "aspect_ratio": payload.get("aspect_ratio"),
                    "user_id": user_id,
                }
                base_request_id = hashlib.sha256(
                    json.dumps(request_seed, ensure_ascii=False, sort_keys=True).encode("utf-8")
                ).hexdigest()[:32]
            request_id = str(base_request_id)
            payload["request_id"] = request_id

            print(f'🎬 ReelMind Video API request - Payload: {payload}')

            # Make API request to reelmind.server with retry mechanism
            headers = {
                "Content-Type": "application/json",
                "X-API-Key": self.api_key  # Add API key for authentication
            }

            # Do not let the python side block indefinitely. The Nest task layer
            # already supports stale-task requeueing, so keep the HTTP wait bounded.
            import asyncio
            video_timeout = httpx.Timeout(
                connect=30.0,    # 连接超时 30 秒
                read=float(kwargs.get("agent_http_read_timeout_seconds", self.AGENT_VIDEO_HTTP_READ_TIMEOUT_SECONDS)),
                write=60.0,      # 写入超时 60 秒
                pool=120.0       # 连接池超时 2 分钟
            )

            max_transport_retries = int(
                kwargs.get("transport_retries", self.AGENT_VIDEO_TRANSPORT_RETRIES) or self.AGENT_VIDEO_TRANSPORT_RETRIES
            )
            max_request_retries = int(
                kwargs.get("request_retries", self.AGENT_VIDEO_REQUEST_RETRY_LIMIT) or self.AGENT_VIDEO_REQUEST_RETRY_LIMIT
            )
            max_fresh_request_retries = int(
                kwargs.get("fresh_request_retries", self.AGENT_VIDEO_FRESH_REQUEST_RETRY_LIMIT)
                or self.AGENT_VIDEO_FRESH_REQUEST_RETRY_LIMIT
            )
            transport_retry_delay = int(
                kwargs.get("transport_retry_delay_seconds", self.AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS)
                or self.AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS
            )
            request_retry_delay = int(
                kwargs.get("request_retry_delay_seconds", self.AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS)
                or self.AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS
            )
            result = None
            total_request_attempts = 0
            last_request_error: Exception | None = None

            for fresh_attempt in range(1, max_fresh_request_retries + 1):
                if fresh_attempt == 1:
                    request_id = str(base_request_id)
                else:
                    request_id = f"{base_request_id}-r{fresh_attempt}-{generate_video_id()[:8]}"
                payload["request_id"] = request_id
                if fresh_attempt > 1:
                    log_runtime_warning(
                        "video.request.retrying_with_fresh_request_id",
                        request_id=request_id,
                        base_request_id=str(base_request_id),
                        fresh_attempt=fresh_attempt,
                        fresh_retry_limit=max_fresh_request_retries,
                        previous_error=(
                            f"{type(last_request_error).__name__}: {last_request_error}"
                            if last_request_error
                            else None
                        ),
                    )
                    print(
                        f'🎬 Re-submitting video generation with fresh request_id '
                        f'{request_id} ({fresh_attempt}/{max_fresh_request_retries})'
                    )

                request_retry_delay_current = request_retry_delay
                transport_retry_delay_current = transport_retry_delay
                try:
                    for request_attempt in range(1, max_request_retries + 1):
                        total_request_attempts += 1
                        try:
                            for transport_attempt in range(1, max_transport_retries + 1):
                                try:
                                    print(
                                        f'🎬 ReelMind Video API attempt fresh {fresh_attempt}/{max_fresh_request_retries}, '
                                        f'request {request_attempt}/{max_request_retries}, '
                                        f'transport {transport_attempt}/{max_transport_retries}'
                                    )

                                    async with HttpClient.create(url=self.api_endpoint, timeout=video_timeout) as client:
                                        response = await client.post(
                                            self.api_endpoint,
                                            headers=headers,
                                            json=payload
                                        )

                                        if response.status_code >= 500:
                                            error_msg = f"HTTP {response.status_code}: {response.text}"
                                            print(
                                                f'🎬 ReelMind Video API server error '
                                                f'(fresh {fresh_attempt}, request {request_attempt}, transport {transport_attempt}): {error_msg}'
                                            )

                                            if transport_attempt < max_transport_retries:
                                                print(f'🎬 Retrying transport in {transport_retry_delay_current} seconds...')
                                                await asyncio.sleep(transport_retry_delay_current)
                                                transport_retry_delay_current *= 2
                                                continue
                                            raise Exception(
                                                f'ReelMind video generation failed after {max_transport_retries} transport attempts: {error_msg}'
                                            )

                                        if response.status_code != 200:
                                            error_msg = f"HTTP {response.status_code}: {response.text}"
                                            print(f'🎬 ReelMind Video API error: {error_msg}')
                                            raise Exception(f'ReelMind video generation failed: {error_msg}')

                                        result = response.json()
                                        print(f'🎬 ReelMind Video API response: {result}')
                                        break

                                except Exception as transport_error:
                                    is_retryable_transport = self._is_request_retryable(transport_error)
                                    if is_retryable_transport and transport_attempt < max_transport_retries:
                                        print(
                                            f'🎬 Retryable transport error on fresh {fresh_attempt}, '
                                            f'request {request_attempt}, transport {transport_attempt}: '
                                            f'{type(transport_error).__name__}: {transport_error}'
                                        )
                                        print(f'🎬 Retrying transport in {transport_retry_delay_current} seconds...')
                                        await asyncio.sleep(transport_retry_delay_current)
                                        transport_retry_delay_current *= 2
                                        continue
                                    raise transport_error

                            if result is not None:
                                break

                        except Exception as request_error:
                            last_request_error = request_error
                            if self._is_request_retryable(request_error) and request_attempt < max_request_retries:
                                log_runtime_warning(
                                    "video.request.retrying",
                                    request_id=request_id,
                                    request_attempt=request_attempt,
                                    request_retry_limit=max_request_retries,
                                    fresh_attempt=fresh_attempt,
                                    fresh_retry_limit=max_fresh_request_retries,
                                    read_timeout_seconds=video_timeout.read,
                                    error=str(request_error),
                                )
                                print(
                                    f'🎬 Request-level video retry {request_attempt}/{max_request_retries} '
                                    f'after error: {type(request_error).__name__}: {request_error}'
                                )
                                print(f'🎬 Re-submitting same request_id in {request_retry_delay_current} seconds...')
                                await asyncio.sleep(request_retry_delay_current)
                                request_retry_delay_current *= 2
                                transport_retry_delay_current = int(
                                    kwargs.get("transport_retry_delay_seconds", self.AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS)
                                    or self.AGENT_VIDEO_REQUEST_RETRY_DELAY_SECONDS
                                )
                                continue
                            raise request_error

                    if result is not None:
                        break
                    if last_request_error and self._is_request_retryable(last_request_error):
                        continue
                except Exception as fresh_error:
                    last_request_error = fresh_error
                    if self._is_request_retryable(fresh_error) and fresh_attempt < max_fresh_request_retries:
                        continue
                    raise fresh_error

            if result is None:
                if last_request_error:
                    raise last_request_error
                raise RuntimeError(f"ReelMind video generation produced no result for request_id={request_id}")

            # Handle response - reelmind.server returns data wrapped in 'data' object
            if result.get('code') != 200:
                error_message = result.get('message', 'Unknown error')
                raise Exception(f'ReelMind video generation failed: {error_message}')

            data = result.get('data', {})
            if not data.get('success'):
                error_message = data.get('message', 'Unknown error')
                raise Exception(f'ReelMind video generation failed: {error_message}')

            # Get the video URL from the response
            video_url = data.get('url')
            if not video_url:
                raise Exception('No URL returned from ReelMind server')

            mime_type = data.get('mime_type', 'video/mp4')
            data["request_attempts"] = total_request_attempts
            data["fresh_request_attempts"] = fresh_attempt
            data["base_request_id"] = str(base_request_id)
            data["request_id"] = request_id

            print(f'🎬 ReelMind video generation completed successfully: {video_url}')
            print(f'🎬 Credits consumed: {data.get("credits_consumed", "unknown")}')
            log_runtime_event(
                "video.request.completed",
                request_id=request_id,
                provider="reelmind",
                duration=payload.get("duration"),
                frames=payload.get("frames"),
                aspect_ratio=payload.get("aspect_ratio"),
                image_ref_count=len(payload.get("image_urls") or []),
                video_ref_count=len(payload.get("video_urls") or []),
                audio_ref_count=len(payload.get("audio_urls") or []),
                credits_consumed=data.get("credits_consumed"),
            )

            if kwargs.get("return_details"):
                return mime_type, video_url, data

            return mime_type, video_url

        except Exception as e:
            print(f'🎬 ReelMind video generation error: {str(e)}')
            traceback.print_exc()
            raise e
