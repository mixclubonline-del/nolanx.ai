import { apiClient, ApiResponse } from '@/lib/api/client'

export interface RuntimeConfigData {
  openrouter_api_key?: string
  openrouter_model?: string
  image_api_key?: string
  image_model?: string
  image_edit_model?: string
  video_api_key?: string
  video_model?: string
  r2_account_id?: string
  r2_access_key_id?: string
  r2_secret_access_key?: string
  r2_bucket_name?: string
  r2_public_url?: string
}

export interface RuntimeConfigStatus {
  mode: 'text-only' | 'script-plus-image' | 'full-video' | 'enhanced-r2'
  textReady: boolean
  scriptReady: boolean
  chatReady: boolean
  imageReady: boolean
  videoReady: boolean
  uploadsReady: boolean
  enhancedStorageReady: boolean
  fullyReady: boolean
  missing: string[]
}

export async function getRuntimeConfig(): Promise<{ config: RuntimeConfigData; status: RuntimeConfigStatus }> {
  const { data } = await apiClient.get<ApiResponse<{ config: RuntimeConfigData; status: RuntimeConfigStatus }>>('/runtime-config')
  return data
}

export async function updateRuntimeConfig(payload: Partial<RuntimeConfigData>): Promise<{ config: RuntimeConfigData; status: RuntimeConfigStatus }> {
  const { data } = await apiClient.update<ApiResponse<{ config: RuntimeConfigData; status: RuntimeConfigStatus }>>('/runtime-config', payload)
  return data
}

export async function uploadRuntimeFile(file: File): Promise<{ url: string; key: string }> {
  const formData = new FormData()
  formData.append('file', file)

  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'
  const response = await fetch(`${baseUrl}/runtime-config/upload`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer nolanx-local-dev-token',
    },
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Upload failed')
  }

  const result = await response.json() as ApiResponse<{ url: string; key: string }>
  return result.data
}
