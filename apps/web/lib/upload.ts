import { uploadRuntimeFile } from '@/lib/nolanx/api/runtime-config'

export type BucketName = 'runtime-upload'

export interface UploadConfig {
  bucketName?: BucketName
  maxSize?: number
  allowedTypes?: string[]
}

const DEFAULT_CONFIG: Required<UploadConfig> = {
  bucketName: 'runtime-upload',
  maxSize: 25 * 1024 * 1024,
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
}

export function validateFileType(file: File, allowedTypes?: string[]): boolean {
  const types = allowedTypes || DEFAULT_CONFIG.allowedTypes
  return types.some((type) => {
    if (type.endsWith('/*')) {
      return file.type.startsWith(type.slice(0, -1))
    }
    return file.type === type
  })
}

export function validateFileSize(file: File, maxSize?: number): boolean {
  const limit = maxSize || DEFAULT_CONFIG.maxSize
  return file.size <= limit
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export async function uploadToCloudflare(file: File, config: UploadConfig = {}): Promise<string> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }
  if (!validateFileType(file, finalConfig.allowedTypes)) {
    throw new Error('Unsupported file type. Please select a valid file.')
  }
  if (!validateFileSize(file, finalConfig.maxSize)) {
    throw new Error(`File size cannot exceed ${formatFileSize(finalConfig.maxSize)}`)
  }
  const uploaded = await uploadRuntimeFile(file)
  return uploaded.url
}

export async function uploadGenerationImage(file: File): Promise<string> {
  return uploadToCloudflare(file, {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/*'],
  })
}

export async function uploadReferenceImage(file: File): Promise<string> {
  return uploadGenerationImage(file)
}

export async function uploadBlogImage(file: File): Promise<string> {
  return uploadGenerationImage(file)
}

export async function uploadReferenceAudio(file: File): Promise<string> {
  return uploadToCloudflare(file, {
    maxSize: 50 * 1024 * 1024,
    allowedTypes: ['audio/*'],
  })
}

export async function uploadMultipleImages(files: File[], config: UploadConfig = {}): Promise<string[]> {
  return Promise.all(files.map((file) => uploadToCloudflare(file, config)))
}

export type UploadProgressCallback = (progress: number) => void

export async function uploadWithProgress(
  file: File,
  onProgress?: UploadProgressCallback,
  config: UploadConfig = {},
): Promise<string> {
  onProgress?.(10)
  const url = await uploadToCloudflare(file, config)
  onProgress?.(100)
  return url
}
