import { Message, Model } from '../types/types'
import { apiClient, ApiResponse } from '@/lib/api/client'

export interface SendMessagesParams {
  sessionId: string
  canvasId: string
  newMessages: Message[]
  preferredLanguage?: string
}

// 获取聊天会话
export const getChatSession = async (sessionId: string): Promise<Message[]> => {
  const { data: res } = await apiClient.get<ApiResponse<any>>(`/chat/session/msgs/${sessionId}`);
  const list = res.map(({ content }: any) => content) as Message[]
  return list;
}

// 发送消息
export const sendMessages = async (payload: SendMessagesParams): Promise<ApiResponse<Message[]>> => {
  const requestData = {
    messages: payload.newMessages,
    canvas_id: payload.canvasId,
    session_id: payload.sessionId,
    preferred_language: payload.preferredLanguage,
  };
  return apiClient.post<ApiResponse<Message[]>>('/chat/send', requestData);
}

// 创建新的聊天会话
export const createChatSession = async (canvasId: string, preferredLanguage?: string): Promise<{ session_id: string }> => {
  const { data: res } = await apiClient.post<ApiResponse<{ session_id: string }>>('/chat/sessions', {
    canvas_id: canvasId,
    preferred_language: preferredLanguage,
  });
  return res;
}

// Fork会话 - 复制会话和canvas
export const forkSession = async (sessionId: string): Promise<{ canvas_id: string; session_id: string }> => {
  const { data: res } = await apiClient.post<ApiResponse<{ canvas_id: string; session_id: string }>>(`/chat/sessions/${sessionId}/fork`, {});
  return res;
}

// 取消聊天
export const cancelChat = async (sessionId: string): Promise<ApiResponse<any>> => {
  return apiClient.post<ApiResponse<any>>(`/chat/session/${sessionId}/cancel`);
}

export interface ActiveChatTasksStatus {
  activeTaskCount: number
  activeSessions: string[]
}

export const getActiveChatTasks = async (): Promise<ActiveChatTasksStatus> => {
  const res = await apiClient.get<ApiResponse<ActiveChatTasksStatus> | ActiveChatTasksStatus>('/chat/status/active-tasks')
  const data = 'data' in res ? res.data : res

  return {
    activeTaskCount: Number(data?.activeTaskCount || 0),
    activeSessions: Array.isArray(data?.activeSessions) ? data.activeSessions : [],
  }
}

export const approveVideoGate = async (sessionId: string, reason = 'generate_now'): Promise<ApiResponse<any>> => {
  return apiClient.post<ApiResponse<any>>(`/chat/session/${sessionId}/video-gate/approve`, { reason });
}

export interface VideoGateState {
  status: 'idle' | 'pending' | 'approved' | 'expired'
  sessionId: string
  batchIndex: number
  totalBatches: number
  clipCount: number
  timeoutSeconds: number
  requestedAt: string
  approvedAt?: string
  expiresAt?: string
}

export const getVideoGateState = async (sessionId: string): Promise<VideoGateState | null> => {
  const { data: res } = await apiClient.get<ApiResponse<{ state: VideoGateState | null }>>(`/chat/session/${sessionId}/video-gate`);
  return res.state;
}
