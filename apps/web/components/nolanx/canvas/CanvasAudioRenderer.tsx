import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, Volume2 } from 'lucide-react'
import { AppState } from '@excalidraw/excalidraw/types'

interface AudioElement {
  id: string
  x: number
  y: number
  width: number
  height: number
  fileId: string
  isAudio?: boolean
  audioType?: string
  prompt?: string
  duration?: number
}

interface CanvasAudioRendererProps {
  excalidrawAPI: any
}

const CanvasAudioRenderer: React.FC<CanvasAudioRendererProps> = ({ excalidrawAPI }) => {
  const [audioElements, setAudioElements] = useState<AudioElement[]>([])
  const [appState, setAppState] = useState<AppState | null>(null)
  const animationFrameRef = useRef<number>(0)

  // 优化的更新函数 - 使用requestAnimationFrame而不是setInterval
  const updateAudioElements = useCallback(() => {
    if (!excalidrawAPI) return

    try {
      const elements = excalidrawAPI.getSceneElements()
      const files = excalidrawAPI.getFiles()
      const currentAppState = excalidrawAPI.getAppState()

      // 过滤出音频元素
      const audios = elements.filter((element: any) =>
        element.isAudio && files[element.fileId]?.mimeType?.startsWith('audio/')
      ) as AudioElement[]

      // 只在音频数量或位置发生变化时更新
      const hasChanged = audios.length !== audioElements.length ||
        audios.some((audio, index) => {
          const prevAudio = audioElements[index]
          return !prevAudio ||
            audio.x !== prevAudio.x ||
            audio.y !== prevAudio.y ||
            audio.width !== prevAudio.width ||
            audio.height !== prevAudio.height
        }) ||
        currentAppState.zoom.value !== appState?.zoom.value ||
        currentAppState.scrollX !== appState?.scrollX ||
        currentAppState.scrollY !== appState?.scrollY

      if (hasChanged) {
        setAudioElements(audios)
        setAppState(currentAppState)
      }
    } catch (error) {
      console.warn('Error updating audio elements:', error)
    }

    // 继续下一帧
    animationFrameRef.current = requestAnimationFrame(updateAudioElements)
  }, [excalidrawAPI, audioElements, appState])

  // 使用requestAnimationFrame进行平滑更新
  useEffect(() => {
    if (!excalidrawAPI) return

    const startUpdating = () => {
      animationFrameRef.current = requestAnimationFrame(updateAudioElements)
    }

    startUpdating()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [excalidrawAPI, updateAudioElements])

  if (!excalidrawAPI || audioElements.length === 0 || !appState) {
    return null
  }

  const { zoom, scrollX, scrollY } = appState

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
      {audioElements.map((audioElement) => {
        // 使用Excalidraw的坐标变换，确保音频完全跟随画布
        const x = (audioElement.x + scrollX) * zoom.value
        const y = (audioElement.y + scrollY) * zoom.value
        const width = audioElement.width * zoom.value
        const height = audioElement.height * zoom.value

        return (
          <AudioComponent
            key={audioElement.id}
            audioElement={audioElement}
            x={x}
            y={y}
            width={width}
            height={height}
            excalidrawAPI={excalidrawAPI}
          />
        )
      })}
    </div>
  )
}

// 单独的音频组件
interface AudioComponentProps {
  audioElement: AudioElement
  x: number
  y: number
  width: number
  height: number
  excalidrawAPI: any
}

const AudioComponent: React.FC<AudioComponentProps> = ({
  audioElement,
  x,
  y,
  width,
  height,
  excalidrawAPI
}) => {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const files = excalidrawAPI?.getFiles()
  const audioFile = files?.[audioElement.fileId]
  const audioUrl = audioFile?.dataURL

  const togglePlay = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  const handlePlay = () => setIsPlaying(true)
  const handlePause = () => setIsPlaying(false)
  const handleEnded = () => setIsPlaying(false)

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0

  if (!audioUrl) return null

  // 简单的最小尺寸处理，避免过度缩放
  const minWidth = 150
  const minHeight = 50
  const actualWidth = Math.max(width, minWidth)
  const actualHeight = Math.max(height, minHeight)

  // 根据实际尺寸计算合适的字体和元素大小
  const scale = Math.min(actualWidth / minWidth, actualHeight / minHeight, 1)
  const fontSize = Math.max(10, 12 * scale)
  const buttonSize = Math.max(24, 32 * scale)
  const iconSize = Math.max(10, 12 * scale)
  const padding = Math.max(6, 8 * scale)

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: x,
        top: y,
        width: actualWidth,
        height: actualHeight,
        transform: 'translate3d(0, 0, 0)', // 硬件加速
        willChange: 'transform', // 优化动画性能
      }}
    >
      <div className="bg-gray-50 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-700 rounded shadow-lg backdrop-blur-sm w-full h-full flex items-center"
        style={{
          padding: `${padding}px`,
          gap: `${padding}px`
        }}>
        {/* 播放按钮 */}
        <button
          onClick={togglePlay}
          className="flex-shrink-0 aspect-square rounded-full bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 flex items-center justify-center transition-colors"
          style={{
            width: `${buttonSize}px`,
            height: `${buttonSize}px`
          }}
        >
          {isPlaying ? (
            <Pause style={{ width: `${iconSize}px`, height: `${iconSize}px` }} />
          ) : (
            <Play style={{ width: `${iconSize}px`, height: `${iconSize}px`, marginLeft: `${scale}px` }} />
          )}
        </button>

        {/* 音频信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center mb-1" style={{ gap: `${padding / 2}px` }}>
            <Volume2 style={{ width: `${iconSize}px`, height: `${iconSize}px` }} className="text-gray-500" />
            <span className="text-gray-600 dark:text-gray-400 truncate" style={{ fontSize: `${fontSize}px` }}>
              {audioElement.audioType === 'tts' ? 'Voice' : 'Sound'}
            </span>
          </div>

          {/* 进度条 */}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full" style={{ height: `${Math.max(3, 4 * scale)}px` }}>
            <div
              className="bg-black dark:bg-white rounded-full transition-all duration-100"
              style={{
                width: `${progressPercentage}%`,
                height: `${Math.max(3, 4 * scale)}px`
              }}
            />
          </div>

          {/* 时间显示 */}
          <div className="text-gray-500" style={{
            fontSize: `${Math.max(9, fontSize * 0.85)}px`,
            marginTop: `${Math.max(2, 4 * scale)}px`
          }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        {/* 隐藏的音频元素 */}
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          preload="metadata"
        />
      </div>
    </div>
  )
}

export default CanvasAudioRenderer
