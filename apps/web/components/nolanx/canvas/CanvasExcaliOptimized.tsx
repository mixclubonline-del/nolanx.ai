import { saveCanvas } from '@/lib/nolanx/api/canvas'
import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import useDebounce from '@/lib/nolanx/hooks/use-debounce'
import { useThemeContext } from '@/contexts/theme-context'
import { eventBus } from '@/lib/nolanx/utils/event'
import * as ISocket from '@/lib/nolanx/types/socket'
import { CanvasData } from '@/lib/nolanx/types/types'
import {
  applyMagneticSnap,
  applyDragMagneticSnap,
  validateAndAdjustMagneticLayout,
  ImageBounds
} from '@/lib/nolanx/utils/magneticSnap'
import { Excalidraw } from '@excalidraw/excalidraw'
import {
  ExcalidrawImageElement,
  OrderedExcalidrawElement,
  Theme,
} from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import CanvasVideoRenderer from './CanvasVideoRenderer'
import CanvasAudioRenderer from './CanvasAudioRenderer'
import { NolanCanvasLoader } from './NolanCanvasLoader'

import '@/styles/nolanx/assets/style/canvas.css'

// 安全的 localStorage 访问
const safeLocalStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === 'undefined') return null
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(key, value)
    } catch {
      // 忽略错误
    }
  }
}

type LastImagePosition = {
  x: number
  y: number
  width: number
  height: number
  col: number
}

type CanvasExcaliOptimizedProps = {
  canvasId: string
  initialData?: ExcalidrawInitialDataState
}

const CanvasExcaliOptimized: React.FC<CanvasExcaliOptimizedProps> = ({
  canvasId,
  initialData,
}) => {
  const { excalidrawAPI, setExcalidrawAPI } = useCanvas()
  const [isMounted, setIsMounted] = useState(false)
  const { i18n } = useTranslation()
  const { theme } = useThemeContext()

  // 性能优化：减少不必要的ref
  const previousElementsRef = useRef<Readonly<OrderedExcalidrawElement[]>>([])
  const magneticSnapTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isMagneticUpdateRef = useRef<boolean>(false)
  const lastSaveTimeRef = useRef<number>(0)
  const lastImagePosition = useRef<LastImagePosition | null>(null)

  // 确保组件已挂载
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // 初始化 lastImagePosition
  useEffect(() => {
    if (isMounted) {
      const stored = safeLocalStorage.getItem('excalidraw-last-image-position')
      lastImagePosition.current = stored ? JSON.parse(stored) : null
    }
  }, [isMounted])

  // 优化的保存处理 - 增加debounce时间，减少频繁保存
  const handleChange = useDebounce(
    (
      elements: Readonly<OrderedExcalidrawElement[]>,
      appState: AppState,
      files: BinaryFiles
    ) => {
      if (elements.length === 0 || !appState) return

      // 防止频繁保存 - 增加到1秒
      const now = Date.now()
      if (now - lastSaveTimeRef.current < 1000) return

      // 如果是磁吸更新触发的，跳过处理避免循环
      if (isMagneticUpdateRef.current) {
        isMagneticUpdateRef.current = false
        return
      }

      lastSaveTimeRef.current = now

      // 在保存前对普通图片进行磁吸重排（排除视频）
      let finalElements = [...elements]
      const regularImageElements = elements.filter(el =>
        el.type === 'image' && !(el as any).isVideo && !(el as any).skipMagneticSnap
      ) as ExcalidrawImageElement[]

      if (regularImageElements.length > 1) {
        const rearrangedImages = applyDragMagneticSnap(regularImageElements)

        finalElements = elements.map(element => {
          if (element.type === 'image' && !(element as any).isVideo && !(element as any).skipMagneticSnap) {
            const rearrangedImg = rearrangedImages.find(img => img.id === element.id)
            if (rearrangedImg) {
              return {
                ...element,
                x: rearrangedImg.x,
                y: rearrangedImg.y
              }
            }
          }
          return element
        })

        // 设置标志位，然后立即更新画布显示
        isMagneticUpdateRef.current = true
        if (excalidrawAPI) {
          const currentAppState = excalidrawAPI.getAppState()
          excalidrawAPI.updateScene({
            elements: finalElements,
            appState: currentAppState
          })
        }
      }

      const data: CanvasData = {
        elements: finalElements,
        appState: {
          ...appState,
          collaborators: undefined!,
        },
        files,
      }

      let thumbnail = ''
      const latestImage = finalElements
        .filter((element) => element.type === 'image')
        .sort((a, b) => b.updated - a.updated)[0]
      if (latestImage) {
        const file = files[latestImage.fileId!]
        if (file) {
          thumbnail = file.dataURL
        }
      }

      saveCanvas(canvasId, { data, thumbnail })
    },
    500 // 增加debounce时间到500ms
  )

  // 优化的磁吸处理 - 减少计算频率
  const handleMagneticSnapOnMove = useCallback(
    (elements: Readonly<OrderedExcalidrawElement[]>) => {
      if (!excalidrawAPI) return

      const currentImages = elements.filter(el => el.type === 'image')
      const previousImages = previousElementsRef.current.filter(el => el.type === 'image')

      // 检测是否有图片位置发生变化
      const movedImages = currentImages.filter(currentImg => {
        const prevImg = previousImages.find(prev => prev.id === currentImg.id)
        return prevImg && (prevImg.x !== currentImg.x || prevImg.y !== currentImg.y)
      })

      if (movedImages.length > 0) {
        // 清除之前的定时器
        if (magneticSnapTimeoutRef.current) {
          clearTimeout(magneticSnapTimeoutRef.current)
        }

        // 增加延迟时间，减少频繁触发
        magneticSnapTimeoutRef.current = setTimeout(() => {
          const updatedElements = [...elements]
          let hasChanges = false

          movedImages.forEach(movedImg => {
            const isVideoElement = (movedImg as any).isVideo

            if (!isVideoElement) {
              // 处理视频跟随
              const prevImg = previousImages.find(prev => prev.id === movedImg.id)
              if (prevImg) {
                const actualDeltaX = movedImg.x - prevImg.x
                const actualDeltaY = movedImg.y - prevImg.y

                // 移动绑定到这个图片的视频
                const boundVideos = currentImages.filter(el =>
                  (el as any).isVideo && (el as any).boundToImageId === movedImg.id
                )

                boundVideos.forEach(video => {
                  const videoIndex = updatedElements.findIndex(el => el.id === video.id)
                  if (videoIndex !== -1) {
                    const newVideoX = video.x + actualDeltaX
                    const newVideoY = video.y + actualDeltaY
                    updatedElements[videoIndex] = {
                      ...updatedElements[videoIndex],
                      x: newVideoX,
                      y: newVideoY
                    }
                    hasChanges = true
                  }
                })
              }

              // 应用磁吸逻辑（只对普通图片）
              const otherImages: ImageBounds[] = currentImages
                .filter(img => img.id !== movedImg.id && !(img as any).isVideo)
                .map(img => ({
                  x: img.x,
                  y: img.y,
                  width: img.width,
                  height: img.height,
                  id: img.id
                }))

              const magneticImg = applyMagneticSnap(movedImg as ExcalidrawImageElement, otherImages)
              const magneticDeltaX = magneticImg.x - movedImg.x
              const magneticDeltaY = magneticImg.y - movedImg.y

              if (magneticDeltaX !== 0 || magneticDeltaY !== 0) {
                const imgIndex = updatedElements.findIndex(el => el.id === movedImg.id)
                if (imgIndex !== -1) {
                  updatedElements[imgIndex] = {
                    ...updatedElements[imgIndex],
                    x: magneticImg.x,
                    y: magneticImg.y
                  }
                  hasChanges = true

                  // 如果图片因为磁吸又移动了，再次移动绑定的视频
                  const boundVideos = currentImages.filter(el =>
                    (el as any).isVideo && (el as any).boundToImageId === movedImg.id
                  )

                  boundVideos.forEach(video => {
                    const videoIndex = updatedElements.findIndex(el => el.id === video.id)
                    if (videoIndex !== -1) {
                      const currentVideoElement = updatedElements[videoIndex]
                      updatedElements[videoIndex] = {
                        ...currentVideoElement,
                        x: currentVideoElement.x + magneticDeltaX,
                        y: currentVideoElement.y + magneticDeltaY
                      }
                    }
                  })
                }
              }
            }
          })

          if (hasChanges) {
            const currentAppState = excalidrawAPI.getAppState()
            excalidrawAPI.updateScene({
              elements: updatedElements,
              appState: currentAppState
            })
          }
        }, 500) // 增加延迟到500ms
      }

      previousElementsRef.current = elements
    },
    [excalidrawAPI]
  )

  // 优化的图片添加函数
  const addImageToExcalidraw = useCallback(
    async (imageElement: ExcalidrawImageElement, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      excalidrawAPI.addFiles([file])
      const currentElements = excalidrawAPI.getSceneElements()

      // 获取现有普通图片元素用于磁吸计算（排除视频）
      const existingImages: ImageBounds[] = currentElements
        .filter((element) => element.type === 'image' && !(element as any).isVideo)
        .map(img => ({
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          id: img.id
        }))

      // 应用磁吸逻辑（只对普通图片）
      const magneticImageElement = applyMagneticSnap(imageElement, existingImages)

      const currentAppState = excalidrawAPI.getAppState()
      excalidrawAPI.updateScene({
        elements: [...(currentElements || []), magneticImageElement],
        appState: currentAppState
      })

      // 更新lastImagePosition为磁吸后的位置
      lastImagePosition.current = {
        x: magneticImageElement.x,
        y: magneticImageElement.y,
        width: magneticImageElement.width,
        height: magneticImageElement.height,
        col: existingImages.length
      }

      safeLocalStorage.setItem(
        'excalidraw-last-image-position',
        JSON.stringify(lastImagePosition.current)
      )
    },
    [excalidrawAPI]
  )

  // 优化的音频添加函数
  const addAudioToExcalidraw = useCallback(
    async (audioElement: any, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      console.log('🎵 Adding audio to canvas:', audioElement)
      console.log('🎵 Audio file data:', file)

      // 添加文件到Excalidraw
      excalidrawAPI.addFiles([file])

      const currentElements = excalidrawAPI.getSceneElements()
      console.log('🎵 Current elements before adding audio:', currentElements.length)

      // 将音频元素转换为image类型以兼容Excalidraw，但保留音频属性
      const excalidrawAudioElement = {
        ...audioElement,
        type: 'image', // Excalidraw只支持image类型
        isAudio: true, // 标记为音频元素
        audioUrl: file.dataURL,
        audioType: audioElement.audioType,
        prompt: audioElement.prompt,
        voice: audioElement.voice,
        duration: audioElement.duration,
      }

      console.log('🎵 ✅ ADDING AUDIO TO CANVAS')
      const updatedElements = [...(currentElements || []), excalidrawAudioElement]
      const currentAppState = excalidrawAPI.getAppState()
      excalidrawAPI.updateScene({
        elements: updatedElements,
        appState: currentAppState
      })

      // 强制刷新视图
      setTimeout(() => {
        excalidrawAPI.refresh()
        console.log('🎵 ✅ CANVAS REFRESHED - AUDIO SHOULD BE VISIBLE')
      }, 100)

      console.log('🎵 ✅ AUDIO SUCCESSFULLY ADDED TO CANVAS!')
    },
    [excalidrawAPI]
  )

  // 重构的视频添加函数 - 移除复杂的覆盖层逻辑
  const addVideoToExcalidraw = useCallback(
    async (videoElement: any, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      excalidrawAPI.addFiles([file])
      const currentElements = excalidrawAPI.getSceneElements()
      const allFiles = excalidrawAPI.getFiles()

      // 简化的源图片查找逻辑
      let sourceImage = null

      // 方式1: 通过inputImageUrl精确匹配
      if (videoElement.inputImageUrl) {
        sourceImage = currentElements.find((el: any) => {
          if (el.type === 'image' && el.fileId && !el.isVideo) {
            const elementFile = allFiles[el.fileId]
            return elementFile && elementFile.dataURL === videoElement.inputImageUrl
          }
          return false
        })
      }

      // 方式2: 使用最近的图片作为备选
      if (!sourceImage) {
        const imageElements = currentElements.filter(el => el.type === 'image' && !(el as any).isVideo)
        if (imageElements.length > 0) {
          sourceImage = imageElements.sort((a, b) => {
            const aTime = (a as any).created || 0
            const bTime = (b as any).created || 0
            return bTime - aTime
          })[0]
        }
      }

      // 设置视频位置 - 简化逻辑
      if (sourceImage) {
        videoElement.x = sourceImage.x
        videoElement.y = sourceImage.y + sourceImage.height + 10 // 紧贴图片下方
        videoElement.width = sourceImage.width
        videoElement.height = sourceImage.height
      } else {
        // 默认位置
        videoElement.x = 100
        videoElement.y = 100
        videoElement.width = 400
        videoElement.height = 300
      }

      // 创建视频元素 - 作为真正的画布元素而不是覆盖层
      const imageVideoElement = {
        ...videoElement,
        type: 'image',
        isVideo: true,
        videoUrl: videoElement.videoUrl || file.dataURL,
        fileId: videoElement.fileId || file.id,
        boundToImageId: sourceImage?.id,
        skipMagneticSnap: true // 防止被磁吸系统重新排列
      }

      const updatedElements = [...(currentElements || []), imageVideoElement]
      const currentAppState = excalidrawAPI.getAppState()
      excalidrawAPI.updateScene({
        elements: updatedElements,
        appState: currentAppState
      })
    },
    [excalidrawAPI]
  )

  // 事件处理函数
  const handleImageGenerated = useCallback(
    (imageData: ISocket.SessionImageGeneratedEvent) => {
      if (imageData.canvas_id !== canvasId) return
      addImageToExcalidraw(imageData.element, imageData.file)
    },
    [addImageToExcalidraw, canvasId]
  )

  const handleAudioGenerated = useCallback(
    (audioData: ISocket.SessionAudioGeneratedEvent) => {
      console.log('🎵 audio_generated event received in CanvasExcaliOptimized:', {
        canvas_id: audioData.canvas_id,
        current_canvas_id: canvasId,
        canvas_id_match: audioData.canvas_id === canvasId,
        element: audioData.element,
        file: audioData.file,
        audio_url: audioData.audio_url
      })

      if (audioData.canvas_id !== canvasId) {
        console.log('🎵 Canvas ID mismatch, ignoring audio:', {
          received: audioData.canvas_id,
          expected: canvasId
        })
        return
      }

      console.log('🎵 Processing audio for current canvas - calling addAudioToExcalidraw')
      addAudioToExcalidraw(audioData.element, audioData.file)
    },
    [addAudioToExcalidraw, canvasId]
  )

  const handleVideoGenerated = useCallback(
    (videoData: ISocket.SessionVideoGeneratedEvent) => {
      if (videoData.canvas_id !== canvasId) return
      addVideoToExcalidraw(videoData.element, videoData.file)
    },
    [addVideoToExcalidraw, canvasId]
  )

  // 事件监听器
  useEffect(() => {
    eventBus.on('Socket::Session::ImageGenerated', handleImageGenerated)
    return () => eventBus.off('Socket::Session::ImageGenerated', handleImageGenerated)
  }, [handleImageGenerated])

  useEffect(() => {
    eventBus.on('Socket::Session::AudioGenerated', handleAudioGenerated)
    return () => eventBus.off('Socket::Session::AudioGenerated', handleAudioGenerated)
  }, [handleAudioGenerated])

  useEffect(() => {
    eventBus.on('Socket::Session::VideoGenerated', handleVideoGenerated)
    return () => eventBus.off('Socket::Session::VideoGenerated', handleVideoGenerated)
  }, [handleVideoGenerated])

  // 设置默认工具
  useEffect(() => {
    if (excalidrawAPI) {
      const timer = setTimeout(() => {
        try {
          excalidrawAPI.setActiveTool({ type: 'selection' })
        } catch (error) {
          console.warn('Failed to set active tool:', error)
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [excalidrawAPI])

  // 修复缺失的音频元素
  useEffect(() => {
    if (!excalidrawAPI) return

    const timer = setTimeout(() => {
      const files = excalidrawAPI.getFiles()
      const elements = excalidrawAPI.getSceneElements()

      // 查找音频文件但没有对应元素的情况
      Object.values(files).forEach((file: any) => {
        if (file.mimeType?.startsWith('audio/')) {
          // 检查是否已经有对应的音频元素
          const hasAudioElement = elements.some((el: any) =>
            el.fileId === file.id && el.isAudio
          )

          if (!hasAudioElement) {
            console.log('🎵 Found orphaned audio file, creating element:', file)

            // 创建音频元素
            const audioElement = {
              type: 'audio',
              id: file.id,
              x: 100,
              y: 100,
              width: 300,
              height: 60,
              angle: 0,
              fileId: file.id,
              strokeColor: '#000000',
              fillStyle: 'solid',
              strokeStyle: 'solid',
              boundElements: null,
              roundness: null,
              frameId: null,
              backgroundColor: 'transparent',
              strokeWidth: 1,
              roughness: 0,
              opacity: 100,
              groupIds: [],
              seed: Math.floor(Math.random() * 1000000),
              version: 1,
              versionNonce: Math.floor(Math.random() * 1000000),
              isDeleted: false,
              index: null,
              updated: 0,
              link: null,
              locked: false,
              status: 'saved',
              scale: [1, 1],
              audioType: file.audioType || 'sound_effects',
              prompt: '',
              voice: null,
              duration: null,
            }

            addAudioToExcalidraw(audioElement, file)
          }
        }
      })
    }, 1000) // 延迟1秒确保画布完全加载

    return () => clearTimeout(timer)
  }, [excalidrawAPI, addAudioToExcalidraw])

  // 移除复杂的自定义渲染逻辑，使用专门的视频渲染器

  // 初始数据处理
  const processedInitialData = useMemo(() => {
    if (!initialData?.elements) return initialData

    // 验证并调整磁吸布局（只对普通图片，排除视频）
    const regularImageElements = initialData.elements.filter(el =>
      el.type === 'image' && !(el as any).isVideo && !(el as any).skipMagneticSnap
    ) as ExcalidrawImageElement[]

    if (regularImageElements.length > 1) {
      const adjustedImages = validateAndAdjustMagneticLayout(regularImageElements)
      const otherElements = initialData.elements.filter(el =>
        el.type !== 'image' || (el as any).isVideo || (el as any).skipMagneticSnap
      )

      return {
        ...initialData,
        elements: [...otherElements, ...adjustedImages],
        appState: {
          ...initialData.appState,
          collaborators: undefined!,
        }
      }
    }

    return {
      ...initialData,
      appState: {
        ...initialData.appState,
        collaborators: undefined!,
      }
    }
  }, [initialData])

  // 只在客户端渲染 Excalidraw
  if (!isMounted) {
    return (
      <NolanCanvasLoader
        compact
        title="Loading Canvas"
        subtitle="Preparing the editor runtime."
        className="h-full rounded-none"
      />
    )
  }

  return (
    <div className="relative w-full h-full">
      <Excalidraw
        theme={theme as Theme}
        langCode={i18n.language}
        excalidrawAPI={(api) => {
          setExcalidrawAPI(api)
        }}
        onChange={(elements, appState, files) => {
          // 处理磁吸
          handleMagneticSnapOnMove(elements)
          // 处理保存
          handleChange(elements, appState, files)
        }}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: true,
            clearCanvas: true,
            export: false,
            loadScene: true,
            saveToActiveFile: true,
            saveAsImage: false,
            toggleTheme: true,
          },
          tools: {
            image: true,
          }
        }}
        initialData={() => processedInitialData || null}
      />

      {/* 使用优化的视频渲染器替代VideoOverlay */}
      <CanvasVideoRenderer excalidrawAPI={excalidrawAPI} />

      {/* 音频渲染器 */}
      <CanvasAudioRenderer excalidrawAPI={excalidrawAPI} />
    </div>
  )
}

export default CanvasExcaliOptimized
