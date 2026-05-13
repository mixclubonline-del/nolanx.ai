import { CanvasData, Message, Session } from '../types/types'
import { apiClient, ApiResponse } from '@/lib/api/client'

export type CanvasItem = {
  id: string
  name: string
  description?: string
  thumbnail?: string
  data?: any
  created_at: string
}

export type ListCanvasesResponse = {
  canvases: CanvasItem[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateCanvasParams {
  canvas_id?: string
  name?: string
  messages: Message[]
  preferred_language?: string
}

export interface SaveCanvasParams {
  data: CanvasData
  thumbnail: string
}

export interface RegenerateTimelineAssetParams {
  prompt?: string
}

// 获取画布列表
export const listCanvases = async (): Promise<CanvasItem[]> => {
  const { data: res } = await apiClient.get<ApiResponse<ListCanvasesResponse>>('/canvas');
  return res.canvases;
};

// 创建画布
export const createCanvas = async (data: CreateCanvasParams): Promise<{ canvas_id: string }> => {
  const { data: res } = await apiClient.post<ApiResponse<{ canvas_id: string }>>('/canvas/create', data);
  return res;
}

// 获取画布详情
export const getCanvas = async (id: string): Promise<{ data: CanvasData; name: string; sessions: Session[] }> => {
  const { data: res } = await apiClient.get<ApiResponse<{ data: CanvasData; name: string; sessions: Session[] }>>(`/canvas/${id}`);
  return res;
}

// 保存画布
export const saveCanvas = async (id: string, payload: SaveCanvasParams): Promise<void> => {
  const { data: res } = await apiClient.post<ApiResponse<void>>(`/canvas/${id}/save`, payload);
  return res;
}

// 重命名画布
export const renameCanvas = async (id: string, name: string): Promise<void> => {
  const { data: res } = await apiClient.post<ApiResponse<void>>(`/canvas/${id}/rename`, { name });
  return res;
}

// 删除画布
export const deleteCanvas = async (id: string): Promise<void> => {
  const { data: res } = await apiClient.post<ApiResponse<void>>(`/canvas/${id}/delete`, {});
  return res;
}

// 更新Timeline资产的startTime
export const updateTimelineAssetStartTimes = async (
  id: string,
  assets: Array<{ id: string; startTime: number }>
): Promise<{ success: boolean; updatedCount: number }> => {
  const { data: res } = await apiClient.post<ApiResponse<{ success: boolean; updatedCount: number }>>(
    `/canvas/${id}/timeline/assets/starttime`,
    { assets }
  );
  return res;
}

export const regenerateTimelineAsset = async (
  id: string,
  assetId: string,
  payload: RegenerateTimelineAssetParams = {}
): Promise<{ success: boolean; asset: any; credits_consumed: number }> => {
  const { data: res } = await apiClient.post<ApiResponse<{ success: boolean; asset: any; credits_consumed: number }>>(
    `/canvas/${id}/timeline/asset/${assetId}/regenerate`,
    payload,
    {
      timeout: 10 * 60 * 1000,
    }
  );
  return res;
}

// 获取分享的画布详情（无需认证）
export const getSharedCanvas = async (id: string): Promise<{ id: string; name: string; canvas_id: string; data: CanvasData; thumbnail?: string; created_at: string; updated_at: string; sessions: Session[] }> => {
  const { data: res } = await apiClient.get<ApiResponse<{ id: string; name: string; canvas_id: string; data: CanvasData; thumbnail?: string; created_at: string; updated_at: string; sessions: Session[] }>>(`/canvas/share/${id}`);
  return res;
}

// 获取分享的聊天历史（无需认证）
export const getSharedChatHistory = async (sessionId: string): Promise<Message[]> => {
  const { data: res } = await apiClient.get<ApiResponse<any>>(`/canvas/share/session/msgs/${sessionId}`);
  const list = res.map(({ content }: any) => content) as Message[]
  return list;
}
