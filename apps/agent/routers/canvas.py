from fastapi import APIRouter, Request, HTTPException
#from routers.agent import chat
from services.chat_service import handle_chat
from services.api_client_service import api_client_service
import asyncio
import json

router = APIRouter(prefix="/api/canvas")

@router.get("/list")
async def list_canvases():
    try:
        result = await api_client_service.list_canvases()
        return result
    except Exception as e:
        print(f"API client failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch canvases from server")

@router.post("/create")
async def create_canvas(request: Request):
    data = await request.json()
    id = data.get('canvas_id')
    name = data.get('name')

    asyncio.create_task(handle_chat(data))
    try:
        await api_client_service.create_canvas(name, id)
        return {"id": id }
    except Exception as e:
        print(f"API client failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create canvas")

@router.get("/{id}")
async def get_canvas(id: str):
    try:
        result = await api_client_service.get_canvas_data(id)
        if result is not None:
            return result
        else:
            raise HTTPException(status_code=404, detail="Canvas not found")
    except Exception as e:
        print(f"API client failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch canvas data")

@router.post("/{id}/save")
async def save_canvas(id: str, request: Request):
    payload = await request.json()
    # 优先使用API客户端，如果失败则回退到本地数据库
    try:
        await api_client_service.save_canvas_data(id, payload['data'], payload.get('thumbnail'))
    except Exception as e:
        print(f"API client failed, falling back to local DB: {e}")
        # 注释掉本地数据库回退，因为已经迁移到API
        # data_str = json.dumps(payload['data'])
        # await db_service.save_canvas_data(id, data_str, payload.get('thumbnail'))
    return {"id": id }

@router.put("/{id}/timeline/assets/starttime")
async def update_timeline_asset_start_times(id: str, request: Request):
    """更新Timeline资产的startTime"""
    payload = await request.json()
    try:
        result = await api_client_service.update_timeline_asset_start_times(id, payload['assets'])
        return result
    except Exception as e:
        print(f"Failed to update timeline asset startTimes: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{id}/rename")
async def rename_canvas(id: str, request: Request):
    data = await request.json()
    name = data.get('name')
    try:
        await api_client_service.rename_canvas(id, name)
        return {"id": id }
    except Exception as e:
        print(f"API client failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to rename canvas")

@router.delete("/{id}/delete")
async def delete_canvas(id: str):
    try:
        await api_client_service.delete_canvas(id)
        return {"id": id }
    except Exception as e:
        print(f"API client failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete canvas")