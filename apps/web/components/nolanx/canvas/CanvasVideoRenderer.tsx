import React, { useEffect, useState, useRef, useCallback } from 'react'
import { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { AppState } from '@excalidraw/excalidraw/types'

interface CanvasVideoRendererProps {
  excalidrawAPI: any
}

interface VideoElement extends OrderedExcalidrawElement {
  isVideo: boolean
  videoUrl: string
  boundToImageId?: string
}

const CanvasVideoRenderer: React.FC<CanvasVideoRendererProps> = ({ excalidrawAPI }) => {
  const [videoElements, setVideoElements] = useState<VideoElement[]>([])
  const [appState, setAppState] = useState<AppState | null>(null)
  const animationFrameRef = useRef<number>()

  // 优化的更新函数 - 使用requestAnimationFrame而不是setInterval
  const updateVideoElements = useCallback(() => {
    if (!excalidrawAPI) return

    try {
      const elements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()

      const videos = elements.filter((el: any) => el.isVideo && el.type === 'image') as VideoElement[]

      // 只在视频数量或位置发生变化时更新
      const hasChanged = videos.length !== videoElements.length ||
        videos.some((video, index) => {
          const prevVideo = videoElements[index]
          return !prevVideo ||
            video.x !== prevVideo.x ||
            video.y !== prevVideo.y ||
            video.width !== prevVideo.width ||
            video.height !== prevVideo.height
        }) ||
        currentAppState.zoom.value !== appState?.zoom.value ||
        currentAppState.scrollX !== appState?.scrollX ||
        currentAppState.scrollY !== appState?.scrollY

      if (hasChanged) {
        setVideoElements(videos)
        setAppState(currentAppState)
      }
    } catch (error) {
      console.warn('Error updating video elements:', error)
    }

    // 继续下一帧
    animationFrameRef.current = requestAnimationFrame(updateVideoElements)
  }, [excalidrawAPI, videoElements, appState])

  // 使用requestAnimationFrame进行平滑更新
  useEffect(() => {
    if (!excalidrawAPI) return

    const startUpdating = () => {
      animationFrameRef.current = requestAnimationFrame(updateVideoElements)
    }

    startUpdating()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [excalidrawAPI, updateVideoElements])

  if (!excalidrawAPI || !appState || videoElements.length === 0) {
    return null
  }

  const { zoom, scrollX, scrollY } = appState

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
      {videoElements.map((videoElement) => {
        // 使用Excalidraw的坐标变换，确保视频完全跟随画布
        const x = (videoElement.x + scrollX) * zoom.value
        const y = (videoElement.y + scrollY) * zoom.value
        const width = videoElement.width * zoom.value
        const height = videoElement.height * zoom.value

        return (
          <VideoComponent
            key={videoElement.id}
            videoElement={videoElement}
            x={x}
            y={y}
            width={width}
            height={height}
          />
        )
      })}
    </div>
  )
}

// 单独的视频组件，优化渲染性能
interface VideoComponentProps {
  videoElement: VideoElement
  x: number
  y: number
  width: number
  height: number
}

const VideoComponent: React.FC<VideoComponentProps> = React.memo(({
  videoElement,
  x,
  y,
  width,
  height
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)

  // 优化视频加载
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.load() // 确保视频正确加载
    }
  }, [videoElement.videoUrl])

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: x,
        top: y,
        width,
        height,
        transform: 'translate3d(0, 0, 0)', // 启用硬件加速
        willChange: 'transform', // 优化动画性能
      }}
    >
      <video
        ref={videoRef}
        src={videoElement.videoUrl}
        className="w-full h-full object-cover rounded-sm border border-blue-400 shadow-md"
        autoPlay
        muted
        loop
        playsInline
        controls
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
          objectFit: 'cover',
        }}
        onError={(e) => {
          console.warn('Video load error:', e)
        }}
      />
      <div className="absolute top-1 left-1 bg-red-500 text-white text-xs px-1 py-0.5 rounded opacity-75">
        VIDEO
      </div>
    </div>
  )
})

VideoComponent.displayName = 'VideoComponent'

export default CanvasVideoRenderer
