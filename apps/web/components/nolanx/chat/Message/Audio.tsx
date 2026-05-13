import { Button } from '../../ui/button'
import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { Play, Pause, Volume2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

type MessageAudioProps = {
  content: {
    audio_url: {
      url: string
    }
    type: 'audio_url'
  }
}

const MessageAudio = ({ content }: MessageAudioProps) => {
  const { excalidrawAPI } = useCanvas()
  const files = excalidrawAPI?.getFiles()
  const filesArray = Object.keys(files || {}).map((key) => ({
    id: key,
    url: files![key].dataURL,
  }))

  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const handleAudioPositioning = (id: string) => {
    excalidrawAPI?.scrollToContent(id, { animate: true })
  }

  const id = filesArray.find((file) =>
    content.audio_url.url?.includes(file.url)
  )?.id

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

  return (
    <div className="mb-6 w-full max-w-full min-w-0">
      <div className="relative group">
        <div className="w-full max-w-full min-w-0 rounded-[1.2rem] border border-white/24 bg-white/26 p-4 shadow-[0_16px_42px_rgba(0,0,0,0.08)] backdrop-blur-[22px] transition-all duration-300 hover:bg-white/34 hover:shadow-[0_22px_52px_rgba(0,0,0,0.12)] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.24),rgba(12,12,11,0.16))]">
          {/* Audio controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={togglePlay}
              className="h-10 w-10 rounded-full bg-black text-white hover:bg-black/85 dark:bg-white/[0.9] dark:text-black dark:hover:bg-white"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4 ml-0.5" />
              )}
            </Button>

            <div className="flex-1">
              {/* Progress bar */}
              <div className="relative mb-1 h-1 rounded-full bg-black/12 dark:bg-white/[0.08]">
                <div
                  className="absolute top-0 left-0 h-full rounded-full bg-black dark:bg-white transition-all duration-100"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              {/* Time display */}
              <div className="flex justify-between text-xs text-neutral-500 dark:text-white/46">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <Volume2 className="h-4 w-4 text-neutral-500 dark:text-white/46" />
          </div>

          {/* Audio element */}
          <audio
            ref={audioRef}
            src={content.audio_url.url}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            preload="metadata"
          />

          {/* Position button for canvas */}
          {id && (
            <Button
              variant="secondary"
              className="absolute top-2 right-2 z-10 rounded-md border border-white/24 bg-white/82 px-2 py-1 text-xs font-medium opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-white group-hover:opacity-100 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]"
              onClick={(e) => {
                e.stopPropagation()
                handleAudioPositioning(id)
              }}
            >
              {t('chat:messages.audioPositioning')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default MessageAudio
