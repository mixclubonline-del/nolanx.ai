"""
API Client Service for communicating with reelmind.server
"""
import aiohttp
import json
from typing import Optional, Dict, Any, List
from services.config_service import config_service

class ApiClientService:
    def __init__(self):
        # 从config.toml获取 reelmind.server 的配置
        self.base_url = config_service.get_reelmind_server_url()
        self.api_key = config_service.get_internal_api_key()
        self.timeout = aiohttp.ClientTimeout(total=30)

        if not self.api_key:
            raise ValueError("internal_api_key is required in config.toml [reelmind_server] section")
        
    async def _make_request(
        self, 
        method: str, 
        endpoint: str, 
        data: Optional[Dict] = None,
        headers: Optional[Dict] = None
    ) -> Optional[Dict[str, Any]]:
        """Make HTTP request to reelmind.server"""
        url = f"{self.base_url}{endpoint}"
        
        # 默认headers，包含API密钥
        default_headers = {
            'Content-Type': 'application/json',
            'X-API-Key': self.api_key,
        }
        if headers:
            default_headers.update(headers)
            
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.request(
                    method=method,
                    url=url,
                    json=data if data else None,
                    headers=default_headers
                ) as response:
                    if response.status == 404:
                        print(f"API endpoint not found: {method} {url}")
                        return None

                    if response.status >= 400:
                        error_text = await response.text()
                        print(f"API request failed with status {response.status}: {error_text}")
                        response.raise_for_status()

                    if response.content_type == 'application/json':
                        return await response.json()
                    else:
                        return {'text': await response.text()}
                        
        except aiohttp.ClientError as e:
            print(f"API request failed: {method} {url} - {str(e)}")
            return None
        except Exception as e:
            print(f"Unexpected error in API request: {str(e)}")
            return None

    async def get_canvas_data(self, canvas_id: str, user_id: str = None) -> Optional[Dict[str, Any]]:
        """Get canvas data from reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id

        response = await self._make_request('GET', f'/internal/canvas/{canvas_id}', headers=headers)
        return response

    async def save_canvas_data(
        self, 
        canvas_id: str, 
        data: Dict[str, Any], 
        thumbnail: Optional[str] = None,
        user_id: str = None
    ) -> bool:
        """Save canvas data to reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        payload = {
            'data': data,
        }
        if thumbnail:
            payload['thumbnail'] = thumbnail
            
        response = await self._make_request(
            'PUT',
            f'/internal/canvas/{canvas_id}',
            data=payload,
            headers=headers
        )
        return response is not None

    async def add_timeline_asset(
        self,
        canvas_id: str,
        asset_type: str,
        asset_data: Dict[str, Any],
        user_id: str = None
    ) -> bool:
        """Add a single asset to timeline track (incremental update)"""
        result = await self.add_timeline_asset_with_detail(
            canvas_id=canvas_id,
            asset_type=asset_type,
            asset_data=asset_data,
            user_id=user_id,
        )
        return bool(result.get("ok"))

    async def add_timeline_asset_with_detail(
        self,
        canvas_id: str,
        asset_type: str,
        asset_data: Dict[str, Any],
        user_id: str = None
    ) -> Dict[str, Any]:
        """Add a single asset to timeline track and return error details on failure."""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id

        payload = {
            'assetType': asset_type,
            'assetData': asset_data,
        }

        url = f"{self.base_url}/internal/canvas/{canvas_id}/timeline/asset"
        default_headers = {
            'Content-Type': 'application/json',
            'X-API-Key': self.api_key,
        }
        default_headers.update(headers)

        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.request(
                    method='POST',
                    url=url,
                    json=payload,
                    headers=default_headers,
                ) as response:
                    raw_text = await response.text()
                    parsed_body: Optional[Dict[str, Any]] = None
                    if response.content_type == 'application/json':
                        try:
                            parsed_body = json.loads(raw_text)
                        except Exception:
                            parsed_body = None

                    if response.status >= 400:
                        error_message = raw_text.strip() or f"HTTP {response.status}"
                        print(
                            f"API request failed with status {response.status}: "
                            f"POST {url} - {error_message}"
                        )
                        return {
                            'ok': False,
                            'status': response.status,
                            'error': error_message,
                            'response': parsed_body,
                        }

                    return {
                        'ok': True,
                        'status': response.status,
                        'response': parsed_body if parsed_body is not None else {'text': raw_text},
                    }
        except aiohttp.ClientError as e:
            error_message = f"{type(e).__name__}: {str(e)}"
            print(f"API request failed: POST {url} - {error_message}")
            return {'ok': False, 'error': error_message}
        except Exception as e:
            error_message = f"{type(e).__name__}: {str(e)}"
            print(f"Unexpected error in API request: POST {url} - {error_message}")
            return {'ok': False, 'error': error_message}

    async def update_timeline_asset_start_times(
        self,
        canvas_id: str,
        assets: List[Dict[str, Any]],
        user_id: str = None
    ) -> Dict[str, Any]:
        """Update startTime for multiple timeline assets"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id

        payload = {
            'assets': assets,
        }

        response = await self._make_request(
            'PUT',
            f'/canvas/{canvas_id}/timeline/assets/starttime',
            data=payload,
            headers=headers
        )
        return response or {'success': False, 'updatedCount': 0}

    async def update_timeline_asset(
        self,
        canvas_id: str,
        asset_id: str,
        start_time: float = None,
        duration: float = None,
        track_id: str = None,
        properties: Dict[str, Any] = None,
        user_id: str = None
    ) -> bool:
        """Update a timeline asset properties"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id

        payload = {}
        if start_time is not None:
            payload['startTime'] = start_time
        if duration is not None:
            payload['duration'] = duration
        if track_id is not None:
            payload['trackId'] = track_id
        if properties is not None:
            payload['properties'] = properties

        response = await self._make_request(
            'PUT',
            f'/internal/canvas/{canvas_id}/timeline/asset/{asset_id}',
            data=payload,
            headers=headers
        )
        return response is not None

    async def update_assets_start_time(
        self,
        canvas_id: str,
        updates: List[Dict[str, Any]],
        user_id: str = None
    ) -> bool:
        """Batch update assets startTime"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id

        payload = {
            'updates': updates
        }

        response = await self._make_request(
            'PUT',
            f'/internal/canvas/{canvas_id}/timeline/assets/starttime',
            data=payload,
            headers=headers
        )
        return response is not None

    async def delete_timeline_asset(
        self,
        canvas_id: str,
        asset_id: str,
        user_id: str = None
    ) -> bool:
        """Delete a timeline asset"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id

        response = await self._make_request(
            'DELETE',
            f'/internal/canvas/{canvas_id}/timeline/asset/{asset_id}',
            headers=headers
        )
        return response is not None

    async def create_canvas(
        self, 
        name: str, 
        canvas_id: str = None,
        user_id: str = None
    ) -> Optional[Dict[str, Any]]:
        """Create canvas in reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        payload = {
            'name': name,
        }
        if canvas_id:
            payload['canvas_id'] = canvas_id
            
        response = await self._make_request(
            'POST',
            '/internal/canvas',
            data=payload,
            headers=headers
        )
        return response

    async def list_canvases(self, user_id: str = None) -> List[Dict[str, Any]]:
        """List canvases from reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        response = await self._make_request('GET', '/internal/canvas', headers=headers)
        if response and 'canvases' in response:
            return response['canvases']
        return []

    async def delete_canvas(self, canvas_id: str, user_id: str = None) -> bool:
        """Delete canvas from reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        response = await self._make_request(
            'DELETE',
            f'/internal/canvas/{canvas_id}',
            headers=headers
        )
        return response is not None

    async def rename_canvas(
        self, 
        canvas_id: str, 
        name: str, 
        user_id: str = None
    ) -> bool:
        """Rename canvas in reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        response = await self._make_request(
            'PUT',
            f'/internal/canvas/{canvas_id}/name',
            data={'name': name},
            headers=headers
        )
        return response is not None

    async def create_chat_session(
        self,
        session_id: str,
        canvas_id: str,
        user_id: str = None,
        title: str = None
    ) -> bool:
        """Create chat session in reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        payload = {
            'session_id': session_id,
            'canvas_id': canvas_id,
        }
        if title:
            payload['title'] = title
            
        response = await self._make_request(
            'POST',
            '/internal/chat/sessions',
            data=payload,
            headers=headers
        )
        return response is not None

    async def create_message(
        self,
        session_id: str,
        role: str,
        content: str,
        user_id: str = None
    ) -> bool:
        """Create message in reelmind.server"""
        headers = {}
        if user_id:
            headers['X-User-ID'] = user_id
            
        payload = {
            'session_id': session_id,
            'role': role,
            'content': content,
        }
        if user_id:
            payload['user_id'] = user_id
            
        response = await self._make_request(
            'POST',
            '/internal/chat/messages',
            data=payload,
            headers=headers
        )
        return response is not None

# Create a singleton instance
api_client_service = ApiClientService()
