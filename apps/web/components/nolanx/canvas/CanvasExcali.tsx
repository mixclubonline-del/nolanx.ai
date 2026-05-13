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
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
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
  col: number // col index
}

// 视频覆盖层组件
interface VideoOverlayProps {
  excalidrawAPI: any
}

const VideoOverlay: React.FC<VideoOverlayProps> = React.memo(({ excalidrawAPI }) => {
  const [videoElements, setVideoElements] = useState<any[]>([])
  const [appState, setAppState] = useState<any>(null)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 防抖更新函数
  const debouncedUpdateVideoElements = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(() => {
      if (!excalidrawAPI) return

      try {
        const elements = excalidrawAPI.getSceneElements()
        const videos = elements.filter((el: any) => el.isVideo && el.type === 'image')

        // 只在视频元素真正变化时才更新
        setVideoElements(prevVideos => {
          if (prevVideos.length !== videos.length) {
            console.log('🎬 Video elements count changed:', videos.length)
            return videos
          }

          // 检查视频位置是否有变化
          const hasPositionChange = videos.some((video: any, index: number) => {
            const prevVideo = prevVideos[index]
            return !prevVideo ||
              prevVideo.x !== video.x ||
              prevVideo.y !== video.y ||
              prevVideo.width !== video.width ||
              prevVideo.height !== video.height
          })

          if (hasPositionChange) {
            console.log('🎬 Video positions changed, updating')
            return videos
          }

          return prevVideos
        })

        // 缓存appState，避免每次渲染都调用
        const currentAppState = excalidrawAPI.getAppState()
        setAppState(currentAppState)
      } catch (error) {
        console.error('🎬 Error updating video elements:', error)
      }
    }, 100) // 减少延迟到100ms
  }, [excalidrawAPI])

  useEffect(() => {
    if (!excalidrawAPI) return

    // 立即执行一次
    debouncedUpdateVideoElements()

    // 监听场景变化 - 移除setInterval，改用事件驱动
    const handleSceneChange = () => {
      debouncedUpdateVideoElements()
    }

    // 监听滚动和缩放变化
    const handleViewportChange = () => {
      if (excalidrawAPI) {
        try {
          const currentAppState = excalidrawAPI.getAppState()
          setAppState(currentAppState)
        } catch (error) {
          console.error('🎬 Error updating app state:', error)
        }
      }
    }

    // 使用更温和的更新策略
    const interval = setInterval(() => {
      if (videoElements.length > 0) {
        handleViewportChange()
      }
    }, 500) // 增加间隔到500ms，并且只在有视频时更新

    return () => {
      clearInterval(interval)
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [excalidrawAPI, debouncedUpdateVideoElements, videoElements.length])

  if (!excalidrawAPI || videoElements.length === 0 || !appState) {
    return null
  }

  const { zoom, scrollX, scrollY } = appState

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {videoElements.map((videoElement: any) => {
        const x = (videoElement.x + scrollX) * zoom.value
        const y = (videoElement.y + scrollY) * zoom.value
        const width = videoElement.width * zoom.value
        const height = videoElement.height * zoom.value

        console.log(`🎬 Rendering video ${videoElement.id} bound to image:`, {
          x, y, width, height,
          originalSize: { width: videoElement.width, height: videoElement.height }
        })

        return (
          <div
            key={videoElement.id}
            className="absolute pointer-events-auto"
            style={{
              left: x,
              top: y,
              width,
              height,
              transform: 'translate(0, 0)',
              zIndex: 1000,
            }}
          >
            <video
              src={videoElement.videoUrl}
              className="w-full h-full object-cover rounded-sm border border-blue-400 shadow-md"
              autoPlay
              muted
              loop
              playsInline
              controls
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                // 确保视频完全填充容器，与图片尺寸一致
                objectFit: 'cover',
              }}
              title={`Video generated from image - ${videoElement.width}x${videoElement.height}`}
            />
            {/* 添加一个小标识表明这是视频 */}
            <div className="absolute top-1 left-1 bg-red-500 text-white text-xs px-1 py-0.5 rounded opacity-75">
              VIDEO
            </div>
          </div>
        )
      })}
    </div>
  )
})

type CanvasExcaliProps = {
  canvasId: string
  initialData?: ExcalidrawInitialDataState
}

const CanvasExcali: React.FC<CanvasExcaliProps> = ({
  canvasId,
  initialData,
}) => {
  const { excalidrawAPI, setExcalidrawAPI } = useCanvas()
  const [isMounted, setIsMounted] = useState(false)

  const { i18n } = useTranslation()

  // 确保组件已挂载
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // 用于跟踪上一次的元素状态，检测移动
  const previousElementsRef = useRef<Readonly<OrderedExcalidrawElement[]>>([])
  const magneticSnapTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // 防止磁吸更新触发循环保存
  const isMagneticUpdateRef = useRef<boolean>(false)
  const lastSaveTimeRef = useRef<number>(0)
  const isVideoAddingRef = useRef<boolean>(false)

  const handleChange = useDebounce(
    (
      elements: Readonly<OrderedExcalidrawElement[]>,
      appState: AppState,
      files: BinaryFiles
    ) => {
      if (elements.length === 0 || !appState) {
        return
      }

      // 防止频繁保存和循环保存
      const now = Date.now()
      if (now - lastSaveTimeRef.current < 500) {
        console.log('🔥 Skipping save - too frequent (< 500ms)')
        return
      }

      // 如果是磁吸更新触发的，跳过处理避免循环
      if (isMagneticUpdateRef.current) {
        console.log('🔥 Skipping save - this is a magnetic update')
        isMagneticUpdateRef.current = false
        return
      }

      // 如果正在添加视频，跳过保存避免干扰
      if (isVideoAddingRef.current) {
        console.log('🔥 Skipping save - video is being added')
        return
      }

      lastSaveTimeRef.current = now

      console.log('🔥🔥🔥 SAVE TRIGGERED - APPLYING MAGNETIC SNAP BEFORE SAVE 🔥🔥🔥')

      // 在保存前对普通图片进行磁吸重排（排除视频）
      let finalElements = [...elements]
      const regularImageElements = elements.filter(el =>
        el.type === 'image' && !(el as any).isVideo && !(el as any).skipMagneticSnap
      ) as ExcalidrawImageElement[]

      if (regularImageElements.length > 1) {
        console.log('🔥 Found', regularImageElements.length, 'regular images (excluding videos), applying magnetic snap before save')
        console.log('🔥 Original positions:', regularImageElements.map(img => ({ id: img.id, x: img.x, y: img.y })))

        // 应用磁吸重排（只对普通图片）
        const rearrangedImages = applyDragMagneticSnap(regularImageElements)
        console.log('🔥 Rearranged positions:', rearrangedImages.map(img => ({ id: img.id, x: img.x, y: img.y })))

        // 更新elements数组（只更新普通图片，保持视频位置不变）
        finalElements = elements.map(element => {
          if (element.type === 'image' && !(element as any).isVideo && !(element as any).skipMagneticSnap) {
            const rearrangedImg = rearrangedImages.find(img => img.id === element.id)
            if (rearrangedImg) {
              console.log(`🔥 Updating regular image ${element.id} for save: ${element.x} -> ${rearrangedImg.x}`)
              return {
                ...element,
                x: rearrangedImg.x,
                y: rearrangedImg.y
              }
            }
          }
          // 保持视频和其他元素位置不变
          return element
        })

        // 设置标志位，然后立即更新画布显示
        isMagneticUpdateRef.current = true
        if (excalidrawAPI) {
          console.log('🔥 UPDATING CANVAS DISPLAY WITH MAGNETIC SNAP (VIDEOS PRESERVED)')
          // 🔧 保持当前的选中状态
          const currentAppState = excalidrawAPI.getAppState()
          excalidrawAPI.updateScene({
            elements: finalElements,
            appState: currentAppState // 保持当前状态，包括选中状态
          })
        }

        console.log('🔥 Final elements for save prepared (videos position preserved)')
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
        const file = files[(latestImage as any).fileId!]
        if (file) {
          thumbnail = file.dataURL
        }
      }

      console.log('🔥 SAVING TO DATABASE WITH MAGNETIC SNAP APPLIED')
      saveCanvas(canvasId, { data, thumbnail })
    },
    200
  )

  // 处理图片移动后的磁吸和视频跟随
  const handleMagneticSnapOnMove = useCallback(
    (elements: Readonly<OrderedExcalidrawElement[]>) => {
      if (!excalidrawAPI) return

      // 🔧 添加防循环检查 - 如果正在进行磁吸更新，跳过
      if (isMagneticUpdateRef.current) {
        console.log('🧲 Skipping magnetic snap - already in progress')
        return
      }

      // 🔧 添加视频添加状态检查
      if (isVideoAddingRef.current) {
        console.log('🧲 Skipping magnetic snap - video is being added')
        return
      }

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

        // 🔧 增加延迟时间，减少频繁触发
        magneticSnapTimeoutRef.current = setTimeout(() => {
          const updatedElements = [...elements]
          let hasChanges = false

          movedImages.forEach(movedImg => {
            // 检查是否是普通图片（非视频）
            const isVideoElement = (movedImg as any).isVideo

            if (!isVideoElement) {
              // 🎬 首先处理视频跟随 - 不管是否有磁吸都要跟随
              const prevImg = previousImages.find(prev => prev.id === movedImg.id)
              if (prevImg) {
                const actualDeltaX = movedImg.x - prevImg.x
                const actualDeltaY = movedImg.y - prevImg.y

                console.log(`🎬 Image ${movedImg.id} moved by:`, { deltaX: actualDeltaX, deltaY: actualDeltaY })

                // 移动绑定到这个图片的视频
                const boundVideos = currentImages.filter(el =>
                  (el as any).isVideo && (el as any).boundToImageId === movedImg.id
                )

                if (boundVideos.length > 0) {
                  console.log(`🎬 Found ${boundVideos.length} bound videos, moving them`)
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
                      console.log(`🎬 Video ${video.id} moved with image:`, {
                        oldPos: { x: video.x, y: video.y },
                        newPos: { x: newVideoX, y: newVideoY },
                        delta: { x: actualDeltaX, y: actualDeltaY }
                      })
                    }
                  })
                }
              }

              // 然后对普通图片应用磁吸（完全排除视频元素）
              const otherImages: ImageBounds[] = currentImages
                .filter(img => img.id !== movedImg.id && !(img as any).isVideo) // 排除视频元素
                .map(img => ({
                  x: img.x,
                  y: img.y,
                  width: img.width,
                  height: img.height,
                  id: img.id
                }))

              console.log('🧲 Applying magnetic snap to regular image:', movedImg.id, 'with other images:', otherImages.length)
              const magneticImg = applyMagneticSnap(movedImg as ExcalidrawImageElement, otherImages)

              // 计算磁吸位置的变化
              const magneticDeltaX = magneticImg.x - movedImg.x
              const magneticDeltaY = magneticImg.y - movedImg.y

              // 只有磁吸位置真的改变了才更新图片位置
              if (magneticDeltaX !== 0 || magneticDeltaY !== 0) {
                const imgIndex = updatedElements.findIndex(el => el.id === movedImg.id)
                if (imgIndex !== -1) {
                  updatedElements[imgIndex] = {
                    ...updatedElements[imgIndex],
                    x: magneticImg.x,
                    y: magneticImg.y
                  }
                  hasChanges = true
                  console.log('👇 magnetic snap on move applied', {
                    original: { x: movedImg.x, y: movedImg.y },
                    magnetic: { x: magneticImg.x, y: magneticImg.y }
                  })

                  // 🎬 如果图片因为磁吸又移动了，再次移动绑定的视频
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
                      console.log(`🎬 Video ${video.id} adjusted for magnetic snap:`, {
                        magneticDelta: { x: magneticDeltaX, y: magneticDeltaY }
                      })
                    }
                  })
                }
              }
            }
          })

          if (hasChanges) {
            // 🔧 设置磁吸更新标志，防止循环
            isMagneticUpdateRef.current = true

            try {
              // 🔧 保持当前的选中状态和其他appState
              const currentAppState = excalidrawAPI.getAppState()
              excalidrawAPI.updateScene({
                elements: updatedElements,
                appState: currentAppState // 保持当前状态，包括选中状态
              })
              console.log('🧲 Updated scene while preserving selection state')
            } catch (error) {
              console.error('🧲 Error updating scene:', error)
            } finally {
              // 🔧 延迟重置标志，确保更新完成
              setTimeout(() => {
                isMagneticUpdateRef.current = false
              }, 50)
            }
          }
        }, 500) // 🔧 增加延迟到500ms，减少频繁触发
      }

      previousElementsRef.current = elements
    },
    [excalidrawAPI]
  )

  const lastImagePosition = useRef<LastImagePosition | null>(null)

  // 初始化 lastImagePosition
  useEffect(() => {
    if (isMounted) {
      const stored = safeLocalStorage.getItem('excalidraw-last-image-position')
      lastImagePosition.current = stored ? JSON.parse(stored) : null
    }
  }, [isMounted])
  const { theme } = useThemeContext()

  const addImageToExcalidraw = useCallback(
    async (imageElement: ExcalidrawImageElement, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      excalidrawAPI.addFiles([file])

      const currentElements = excalidrawAPI.getSceneElements()
      console.log('👇 adding to currentElements', currentElements)

      // 获取现有普通图片元素用于磁吸计算（排除视频）
      const existingImages: ImageBounds[] = currentElements
        .filter((element) => element.type === 'image' && !(element as any).isVideo) // 排除视频元素
        .map(img => ({
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          id: img.id
        }))

      // 应用磁吸逻辑（只对普通图片）
      const magneticImageElement = applyMagneticSnap(imageElement, existingImages)
      console.log('👇 magnetic snap applied to regular image', { original: imageElement, magnetic: magneticImageElement })

      // 🔧 保持当前的选中状态
      const currentAppState = excalidrawAPI.getAppState()
      excalidrawAPI.updateScene({
        elements: [...(currentElements || []), magneticImageElement],
        appState: currentAppState // 保持当前状态，包括选中状态
      })

      // 强制刷新视图确保图片显示
      setTimeout(() => {
        excalidrawAPI.refresh()
        console.log('👇 ✅ IMAGE ADDED TO CANVAS - CANVAS REFRESHED')
      }, 100)

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

  const addAudioToExcalidraw = useCallback(
    async (audioElement: any, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      console.log('🎵 Adding audio to canvas:', audioElement)
      console.log('🎵 Audio file data:', file)

      // 添加文件到Excalidraw
      excalidrawAPI.addFiles([file])

      const currentElements = excalidrawAPI.getSceneElements()
      console.log('🎵 Current elements before adding audio:', currentElements.length)

      // 查找合适的位置放置音频元素
      let audioX = 100
      let audioY = 100

      // 如果有其他元素，放在右侧
      if (currentElements.length > 0) {
        const lastElement = currentElements[currentElements.length - 1]
        audioX = lastElement.x + lastElement.width + 50
        audioY = lastElement.y
      }

      // 创建音频元素（使用image类型但标记为音频）
      const imageAudioElement = {
        ...audioElement,
        x: audioX,
        y: audioY,
        width: 200,
        height: 60,
        isAudio: true, // 标记为音频元素
        audioUrl: file.dataURL,
      }

      console.log('🎵 ✅ ADDING AUDIO TO CANVAS')
      const updatedElements = [...(currentElements || []), imageAudioElement]
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

  const addVideoToExcalidraw = useCallback(
    async (videoElement: any, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      // 🎬 设置视频添加标志，防止保存干扰
      isVideoAddingRef.current = true
      console.log('🎬 Adding video to canvas:', videoElement)
      console.log('🎬 Video file data:', file)

      // 添加文件到Excalidraw
      excalidrawAPI.addFiles([file])

      const currentElements = excalidrawAPI.getSceneElements()
      console.log('🎬 Current elements before adding video:', currentElements.length)

      // 查找源图片的多种方式
      let sourceImage = null
      const allFiles = excalidrawAPI.getFiles()
      console.log('🎬 All files in canvas:', Object.keys(allFiles).length)

      // 🎬 详细日志输出
      console.log('🎬 =================== VIDEO MATCHING DEBUG ===================')
      console.log('🎬 Video element details:', {
        inputImageUrl: videoElement.inputImageUrl,
        input_image: videoElement.input_image,
        sourceImageUrl: videoElement.sourceImageUrl,
        allFields: Object.keys(videoElement)
      })

      const availableImages = currentElements
        .filter(el => el.type === 'image' && !(el as any).isVideo)
        .map(el => ({
          id: el.id,
          fileId: (el as any).fileId,
          dataURL: allFiles[(el as any).fileId]?.dataURL,
          shortURL: allFiles[(el as any).fileId]?.dataURL?.substring(0, 100) + '...'
        }))

      console.log('🎬 Available images in canvas:', availableImages.length)
      availableImages.forEach((img, index) => {
        console.log(`🎬 Image ${index + 1}:`, {
          id: img.id,
          fileId: img.fileId,
          shortURL: img.shortURL
        })
      })

      // 方式1: 通过inputImageUrl精确匹配
      if (videoElement.inputImageUrl) {
        console.log('🎬 Looking for source image with inputImageUrl:', videoElement.inputImageUrl)

        sourceImage = currentElements.find((el: any) => {
          if (el.type === 'image' && el.fileId && !el.isVideo) {
            const elementFile = allFiles[el.fileId]
            if (elementFile) {
              const isMatch = elementFile.dataURL === videoElement.inputImageUrl
              console.log(`🎬 Checking element ${el.id}: ${isMatch ? 'MATCH!' : 'no match'}`)
              return isMatch
            }
          }
          return false
        })
      }

      // 方式2: 如果精确匹配失败，尝试部分匹配
      if (!sourceImage && videoElement.inputImageUrl) {
        console.log('🎬 Trying partial URL matching')

        sourceImage = currentElements.find((el: any) => {
          if (el.type === 'image' && el.fileId && !el.isVideo) {
            const elementFile = allFiles[el.fileId]
            if (elementFile && elementFile.dataURL && videoElement.inputImageUrl) {
              // 提取文件名进行匹配
              const extractFileName = (url: string) => {
                const parts = url.split('/')
                return parts[parts.length - 1].split('?')[0]
              }

              const elementFileName = extractFileName(elementFile.dataURL)
              const inputFileName = extractFileName(videoElement.inputImageUrl)

              const isMatch = elementFileName === inputFileName ||
                elementFile.dataURL.includes(inputFileName) ||
                videoElement.inputImageUrl.includes(elementFileName)

              console.log(`🎬 Partial match check for ${el.id}:`, {
                elementFileName,
                inputFileName,
                isMatch
              })

              return isMatch
            }
          }
          return false
        })
      }

      // 方式3: 如果还是没找到，尝试通过时间戳匹配最近的图片
      if (!sourceImage) {
        console.log('🎬 No URL match found, trying timestamp-based matching')
        const imageElements = currentElements.filter(el => el.type === 'image' && !(el as any).isVideo)

        if (imageElements.length > 0) {
          // 按创建时间排序，找最近的图片
          const sortedImages = imageElements.sort((a, b) => {
            const aTime = (a as any).created || 0
            const bTime = (b as any).created || 0
            return bTime - aTime // 降序，最新的在前
          })

          sourceImage = sortedImages[0]
          console.log('🎬 Using most recent image as source:', sourceImage.id)
        }
      }

      // 方式4: 智能匹配策略 - 使用最近生成的图片
      if (!sourceImage) {
        console.log('🎬 Using smart matching - finding most recent image')
        const imageElements = currentElements.filter(el => el.type === 'image' && !(el as any).isVideo)

        if (imageElements.length > 0) {
          // 按创建时间排序，找最新的图片
          const sortedByTime = imageElements.sort((a, b) => {
            const aTime = (a as any).created || 0
            const bTime = (b as any).created || 0
            return bTime - aTime // 降序，最新的在前
          })

          sourceImage = sortedByTime[0]
          console.log('🎬 ✅ SMART MATCH with most recent image:', sourceImage.id)
        } else {
          console.log('🎬 ❌ NO IMAGES FOUND AT ALL!')
        }
      }

      // 方式5: 最后的强制匹配 - 如果还是没找到，使用最后一个图片
      if (!sourceImage) {
        console.log('🎬 FINAL FALLBACK - using last image element')
        const imageElements = currentElements.filter(el => el.type === 'image' && !(el as any).isVideo)
        if (imageElements.length > 0) {
          sourceImage = imageElements[imageElements.length - 1]
          console.log('🎬 ✅ FALLBACK match with image:', sourceImage.id)
        }
      }

      // 最终确认
      console.log('🎬 =================== FINAL MATCH RESULT ===================')
      if (sourceImage) {
        console.log('🎬 ✅ SOURCE IMAGE FOUND:', {
          id: sourceImage.id,
          x: sourceImage.x,
          y: sourceImage.y,
          width: sourceImage.width,
          height: sourceImage.height,
          created: (sourceImage as any).created
        })
      } else {
        console.log('🎬 ❌ CRITICAL: NO SOURCE IMAGE AVAILABLE!')
        console.log('🎬 Total elements in canvas:', currentElements.length)
        console.log('🎬 Image elements:', currentElements.filter(el => el.type === 'image').length)
        console.log('🎬 Non-video images:', currentElements.filter(el => el.type === 'image' && !(el as any).isVideo).length)
      }

      if (sourceImage) {
        console.log('🎬 ✅ FOUND SOURCE IMAGE:', sourceImage.id, {
          x: sourceImage.x,
          y: sourceImage.y,
          width: sourceImage.width,
          height: sourceImage.height
        })

        // 将视频完全绑定到图片：位置紧贴图片下方，尺寸与图片完全一致
        const gap = 0 // 无间隙，紧贴显示
        videoElement.x = sourceImage.x // 完全对齐X坐标
        videoElement.y = sourceImage.y + sourceImage.height + gap // 紧贴图片下方
        videoElement.width = sourceImage.width // 宽度与图片完全一致
        videoElement.height = sourceImage.height // 高度与图片完全一致

        console.log(`🎬 ✅ VIDEO POSITIONED BELOW IMAGE:`, {
          videoX: videoElement.x,
          videoY: videoElement.y,
          videoWidth: videoElement.width,
          videoHeight: videoElement.height,
          imageBottom: sourceImage.y + sourceImage.height
        })
      } else {
        console.log('🎬 ❌ NO SOURCE IMAGE FOUND - This should not happen!')
        console.log('🎬 Available elements:', currentElements.map(el => ({
          id: el.id,
          type: el.type,
          isVideo: (el as any).isVideo
        })))

        // 紧急备选方案：找到最右边的图片，将视频放在其右边
        const imageElements = currentElements.filter(el => el.type === 'image' && !(el as any).isVideo)
        if (imageElements.length > 0) {
          const rightmostImage = imageElements.reduce((rightmost, current) =>
            current.x > rightmost.x ? current : rightmost
          )

          videoElement.x = rightmostImage.x + rightmostImage.width + 20 // 放在最右边图片的右侧
          videoElement.y = rightmostImage.y // 对齐Y坐标
          videoElement.width = rightmostImage.width // 使用相同宽度
          videoElement.height = rightmostImage.height // 使用相同高度

          console.log('🎬 ⚠️ Using emergency positioning next to rightmost image')
        } else {
          // 最后的备选方案
          videoElement.x = 100
          videoElement.y = 100
          videoElement.width = 400
          videoElement.height = 300
          console.log('🎬 ⚠️ Using default positioning')
        }
      }

      // 将video元素转换为image元素，确保包含所有必要的Excalidraw属性
      const imageVideoElement = {
        ...videoElement,
        type: 'image', // 转换为image类型
        // 确保所有必要的数组属性存在，防止length错误
        groupIds: videoElement.groupIds || [],
        // 保留video相关信息作为自定义属性
        isVideo: true,
        videoUrl: videoElement.videoUrl || file.dataURL,
        originalType: 'video',
        // 确保有fileId
        fileId: videoElement.fileId || file.id,
        // 添加绑定信息，表明这个视频绑定到哪个图片
        boundToImageId: sourceImage?.id,
        // 标记为磁吸绑定元素，在磁吸计算时特殊处理
        isMagneticBound: true,
        // 🎬 关键：添加特殊标记，防止被磁吸系统重新排列
        skipMagneticSnap: true,
        // 确保所有必需的Excalidraw属性都有正确的默认值
        strokeSharpness: videoElement.strokeSharpness || 'sharp',
        backgroundColor: videoElement.backgroundColor || 'transparent',
        fillStyle: videoElement.fillStyle || 'solid',
        strokeWidth: videoElement.strokeWidth || 1,
        strokeStyle: videoElement.strokeStyle || 'solid',
        roughness: videoElement.roughness || 1,
        opacity: videoElement.opacity || 100,
        frameId: videoElement.frameId || null,
        roundness: videoElement.roundness || null,
        seed: videoElement.seed || Math.floor(Math.random() * 2 ** 31),
        versionNonce: videoElement.versionNonce || Math.floor(Math.random() * 2 ** 31),
        isDeleted: videoElement.isDeleted || false,
        link: videoElement.link || null,
        locked: videoElement.locked || false,
        // 🔧 添加更多可能缺失的属性，防止length错误
        strokeColor: videoElement.strokeColor || '#000000',
        angle: videoElement.angle || 0,
        // 确保scale属性存在且为数组
        scale: videoElement.scale || [1, 1],
        // 确保customData存在
        customData: videoElement.customData || null,
        // 确保boundElements存在且为数组
        boundElements: videoElement.boundElements || [],
        // 确保updated时间戳存在
        updated: videoElement.updated || Date.now(),
        // 确保created时间戳存在
        created: videoElement.created || Date.now()
      }

      console.log('🎬 ✅ FINAL VIDEO ELEMENT READY:', {
        id: imageVideoElement.id,
        x: imageVideoElement.x,
        y: imageVideoElement.y,
        width: imageVideoElement.width,
        height: imageVideoElement.height,
        fileId: imageVideoElement.fileId,
        isVideo: imageVideoElement.isVideo,
        boundToImageId: imageVideoElement.boundToImageId,
        skipMagneticSnap: imageVideoElement.skipMagneticSnap,
        positionedBelowImage: sourceImage ? `${sourceImage.id} at y=${sourceImage.y + sourceImage.height}` : 'none'
      })

      // 🎬 直接添加到画布，完全跳过磁吸系统
      console.log('🎬 ✅ ADDING VIDEO TO CANVAS - BYPASSING ALL MAGNETIC SNAP LOGIC')
      const updatedElements = [...(currentElements || []), imageVideoElement]
      // 🔧 保持当前的选中状态
      const currentAppState = excalidrawAPI.getAppState()
      excalidrawAPI.updateScene({
        elements: updatedElements,
        appState: currentAppState // 保持当前状态，包括选中状态
      })

      // 强制刷新视图
      setTimeout(() => {
        excalidrawAPI.refresh()
        console.log('🎬 ✅ CANVAS REFRESHED - VIDEO SHOULD BE VISIBLE BELOW IMAGE')
        // 清除视频添加标志
        isVideoAddingRef.current = false
      }, 100)

      console.log('🎬 ✅ VIDEO SUCCESSFULLY ADDED TO CANVAS - POSITION LOCKED!')
    },
    [excalidrawAPI]
  )

  const handleImageGenerated = useCallback(
    (imageData: ISocket.SessionImageGeneratedEvent) => {
      console.log('👇image_generated', imageData)
      if (imageData.canvas_id !== canvasId) {
        return
      }

      if (!imageData.element || !imageData.file) {
        console.log('🖼️ image_generated missing element/file; skipping direct canvas insert (timeline will refresh via Canvas::DataUpdated).')
        return
      }

      addImageToExcalidraw(imageData.element, imageData.file)
    },
    [addImageToExcalidraw]
  )

  const handleAudioGenerated = useCallback(
    (audioData: ISocket.SessionAudioGeneratedEvent) => {
      console.log('🎵 audio_generated event received:', {
        canvas_id: audioData.canvas_id,
        current_canvas_id: canvasId,
        element: audioData.element,
        file: audioData.file,
        audio_url: audioData.audio_url
      })

      if (audioData.canvas_id !== canvasId) {
        console.log('🎵 Canvas ID mismatch, ignoring audio')
        return
      }

      console.log('🎵 Processing audio for current canvas')
      if (!audioData.element || !audioData.file) {
        console.log('🎵 audio_generated missing element/file; skipping direct canvas insert (timeline will refresh via Canvas::DataUpdated).')
        return
      }
      addAudioToExcalidraw(audioData.element, audioData.file)
    },
    [addAudioToExcalidraw, canvasId]
  )

  const handleVideoGenerated = useCallback(
    (videoData: ISocket.SessionVideoGeneratedEvent) => {
      console.log('🎬 video_generated event received:', {
        canvas_id: videoData.canvas_id,
        current_canvas_id: canvasId,
        element: videoData.element,
        file: videoData.file,
        video_url: videoData.video_url
      })

      if (videoData.canvas_id !== canvasId) {
        console.log('🎬 Canvas ID mismatch, ignoring video')
        return
      }

      console.log('🎬 Processing video for current canvas')
      if (!videoData.element || !videoData.file) {
        console.log('🎬 video_generated missing element/file; skipping direct canvas insert (timeline will refresh via Canvas::DataUpdated).')
        return
      }
      addVideoToExcalidraw(videoData.element, videoData.file)
    },
    [addVideoToExcalidraw, canvasId]
  )

  const handleImageEditStart = useCallback(
    (editData: ISocket.SessionImageEditStartEvent) => {
      console.log('🖼️ image_edit_start event received:', {
        canvas_id: editData.canvas_id,
        current_canvas_id: canvasId,
        image_id: editData.image_id || editData?.data?.file_id,
        edit_request: editData.edit_request || editData?.data?.prompt,
        original_image_url: editData.original_image_url || editData?.data?.input_image
      })

      if (editData.canvas_id !== canvasId) {
        console.log('🖼️ Canvas ID mismatch, ignoring image edit start')
        return
      }

      // 可以在这里添加UI反馈，比如显示编辑进度指示器
      console.log('🖼️ Image editing started for image:', editData.image_id || editData?.data?.file_id)

      // 可以通过eventBus发送到其他组件显示编辑状态
      // eventBus.emit('Canvas::ImageEditStart', editData)
    },
    [canvasId]
  )

  const handleImageEditComplete = useCallback(
    (editData: ISocket.SessionImageEditCompleteEvent) => {
      console.log('🖼️ image_edit_complete event received:', {
        canvas_id: editData.canvas_id,
        current_canvas_id: canvasId,
        image_id: editData.image_id,
        element: editData.element,
        file: editData.file,
        edited_image_url: editData.edited_image_url,
        original_image_url: editData.original_image_url
      })

      if (editData.canvas_id !== canvasId) {
        console.log('🖼️ Canvas ID mismatch, ignoring image edit complete')
        return
      }

      console.log('🖼️ Processing edited image for current canvas')

      // 查找并替换原始图片元素
      if (excalidrawAPI) {
        const currentElements = excalidrawAPI.getSceneElements()
        const targetImageIndex = currentElements.findIndex(
          (el: any) => el.id === editData.image_id && el.type === 'image'
        )

        if (targetImageIndex !== -1) {
          console.log('🖼️ Found target image to replace:', editData.image_id)

          // 添加新的编辑后的图片文件
          excalidrawAPI.addFiles([editData.file])

          // 更新元素，保持位置和尺寸，但使用新的文件
          const updatedElements = [...currentElements]
          const originalElement = currentElements[targetImageIndex]
          updatedElements[targetImageIndex] = {
            ...editData.element,
            // 保持原始位置和尺寸（如果需要的话）
            x: originalElement.x,
            y: originalElement.y,
            width: originalElement.width,
            height: originalElement.height,
            // 确保保持必要的Excalidraw属性
            index: originalElement.index,
            versionNonce: originalElement.versionNonce,
            updated: Date.now()
          }

          const currentAppState = excalidrawAPI.getAppState()
          excalidrawAPI.updateScene({
            elements: updatedElements,
            appState: currentAppState
          })

          console.log('🖼️ ✅ Image successfully replaced with edited version')
        } else {
          console.log('🖼️ ⚠️ Target image not found, adding as new image')
          // 如果找不到原始图片，就作为新图片添加
          addImageToExcalidraw(editData.element, editData.file)
        }
      }
    },
    [canvasId, excalidrawAPI, addImageToExcalidraw]
  )

  useEffect(() => {
    eventBus.on('Socket::Session::ImageGenerated', handleImageGenerated)
    return () =>
      eventBus.off('Socket::Session::ImageGenerated', handleImageGenerated)
  }, [handleImageGenerated])

  useEffect(() => {
    eventBus.on('Socket::Session::AudioGenerated', handleAudioGenerated)
    return () =>
      eventBus.off('Socket::Session::AudioGenerated', handleAudioGenerated)
  }, [handleAudioGenerated])

  useEffect(() => {
    eventBus.on('Socket::Session::VideoGenerated', handleVideoGenerated)
    return () =>
      eventBus.off('Socket::Session::VideoGenerated', handleVideoGenerated)
  }, [handleVideoGenerated])

  useEffect(() => {
    eventBus.on('Socket::Session::ImageEditStart', handleImageEditStart)
    return () =>
      eventBus.off('Socket::Session::ImageEditStart', handleImageEditStart)
  }, [handleImageEditStart])

  useEffect(() => {
    eventBus.on('Socket::Session::ImageEditComplete', handleImageEditComplete)
    return () =>
      eventBus.off('Socket::Session::ImageEditComplete', handleImageEditComplete)
  }, [handleImageEditComplete])

  // 🔧 设置默认工具为Scene Select (V) - 在组件挂载后安全执行
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
          // 🔧 添加防护检查，避免在特殊状态下触发onChange处理
          if (!isMagneticUpdateRef.current && !isVideoAddingRef.current) {
            // 处理磁吸
            handleMagneticSnapOnMove(elements)
            // 处理保存
            handleChange(elements, appState, files)
          } else {
            console.log('🔧 Skipping onChange processing - in special state')
            // 重置磁吸更新标志（如果是磁吸更新触发的onChange）
            if (isMagneticUpdateRef.current) {
              setTimeout(() => {
                isMagneticUpdateRef.current = false
              }, 10)
            }
          }
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
        renderTopRightUI={() => (
          <style>{`
            /* 🔧 隐藏不需要的工具按钮 - 更全面的选择器 */
            .App-toolbar button[data-testid="toolbar-rectangle"],
            .App-toolbar button[data-testid="toolbar-ellipse"],
            .App-toolbar button[data-testid="toolbar-arrow"],
            .App-toolbar button[data-testid="toolbar-line"],
            .App-toolbar button[data-testid="toolbar-freedraw"],
            .App-toolbar button[data-testid="toolbar-frame"],
            .App-toolbar button[data-testid="toolbar-magicframe"],
            .App-toolbar button[data-testid="toolbar-embeddable"],
            .App-toolbar button[data-testid="toolbar-laser"],
            .App-toolbar button[data-testid="toolbar-eraser"],
            /* 🔧 额外的选择器以确保隐藏 */
            .App-toolbar .ToolIcon[data-testid="toolbar-rectangle"],
            .App-toolbar .ToolIcon[data-testid="toolbar-ellipse"],
            .App-toolbar .ToolIcon[data-testid="toolbar-arrow"],
            .App-toolbar .ToolIcon[data-testid="toolbar-line"],
            .App-toolbar .ToolIcon[data-testid="toolbar-freedraw"],
            .App-toolbar .ToolIcon[data-testid="toolbar-frame"],
            .App-toolbar .ToolIcon[data-testid="toolbar-magicframe"],
            .App-toolbar .ToolIcon[data-testid="toolbar-embeddable"],
            .App-toolbar .ToolIcon[data-testid="toolbar-laser"],
            .App-toolbar .ToolIcon[data-testid="toolbar-eraser"],
            /* 🔧 通过类名隐藏 */
            .App-toolbar .ToolIcon--rectangle,
            .App-toolbar .ToolIcon--ellipse,
            .App-toolbar .ToolIcon--arrow,
            .App-toolbar .ToolIcon--line,
            .App-toolbar .ToolIcon--freedraw,
            .App-toolbar .ToolIcon--frame,
            .App-toolbar .ToolIcon--magicframe,
            .App-toolbar .ToolIcon--embeddable,
            .App-toolbar .ToolIcon--laser,
            .App-toolbar .ToolIcon--eraser {
              display: none !important;
            }

            /* 🔧 修正工具提示文本和显示快捷键 */
            .App-toolbar button[data-testid="toolbar-hand"] .ToolIcon__keybinding {
              display: block !important;
            }
            .App-toolbar button[data-testid="toolbar-hand"] .ToolIcon__keybinding::after {
              content: "H" !important;
            }

            .App-toolbar button[data-testid="toolbar-selection"] .ToolIcon__keybinding {
              display: block !important;
            }
            .App-toolbar button[data-testid="toolbar-selection"] .ToolIcon__keybinding::after {
              content: "V" !important;
            }

            .App-toolbar button[data-testid="toolbar-text"] .ToolIcon__keybinding {
              display: block !important;
            }
            .App-toolbar button[data-testid="toolbar-text"] .ToolIcon__keybinding::after {
              content: "T" !important;
            }

            .App-toolbar button[data-testid="toolbar-image"] .ToolIcon__keybinding {
              display: block !important;
            }
            .App-toolbar button[data-testid="toolbar-image"] .ToolIcon__keybinding::after {
              content: "9" !important;
            }

            /* 🔧 确保右键菜单正常显示 */
            .context-menu,
            .ContextMenu,
            .excalidraw-contextmenu,
            .excalidraw .context-menu {
              display: block !important;
              visibility: visible !important;
              pointer-events: auto !important;
            }

            /* 🔧 确保右键菜单项可见 */
            .context-menu__item,
            .ContextMenu__item {
              display: block !important;
            }
          `}</style>
        )}
        initialData={() => {
          const data = initialData
          console.log('👇initialData', data)

          // 如果有初始数据，验证并调整磁吸布局（只对普通图片，排除视频）
          if (data?.elements) {
            const regularImageElements = data.elements.filter((el: any) =>
              el.type === 'image' && !el.isVideo && !el.skipMagneticSnap
            ) as ExcalidrawImageElement[]

            if (regularImageElements.length > 1) {
              const adjustedImages = validateAndAdjustMagneticLayout(regularImageElements)
              const otherElements = data.elements.filter((el: any) =>
                el.type !== 'image' || el.isVideo || el.skipMagneticSnap
              )
              data.elements = [...otherElements, ...adjustedImages]
              console.log('👇 magnetic layout adjusted for initial data (excluding videos)')
            }
          }

          if (data?.appState) {
            data.appState = {
              ...data.appState,
              collaborators: undefined!,
            }
          }
          return data || null
        }}
      />

      {/* 视频覆盖层 */}
      <VideoOverlay excalidrawAPI={excalidrawAPI} />
    </div>
  )
}
export default CanvasExcali
