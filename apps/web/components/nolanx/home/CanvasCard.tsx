import { deleteCanvas, CanvasItem } from '@/lib/nolanx/api/canvas'
import { ImageIcon, Trash2, PlayIcon, Volume2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, useMemo } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { formatDate } from '@/lib/nolanx/utils/formatDate'
import CanvasDeleteDialog from './CanvasDeleteDialog'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { localizePathname } from '@/i18n/pathname'

type CanvasCardProps = {
  index: number
  canvas: CanvasItem
  handleCanvasClick: (id: string, path: string) => void
  handleDeleteCanvas: (id: string) => void
}

const CanvasCard: React.FC<CanvasCardProps> = ({
  index,
  canvas,
  handleCanvasClick,
  handleDeleteCanvas,
}) => {
  const { t, i18n } = useTranslation()
  const locale = useLocale()
  const appLocale = locale === 'zh-CN' ? 'zh-CN' : 'en'
  const router = useRouter()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const canvasPath = localizePathname(`/canvas/${canvas.id}`, appLocale)

  const coverMedia = useMemo(() => {
    const timelineData = canvas.data?.timeline
    let timelineAssets: any[] = []

    if (timelineData?.tracks) {
      timelineAssets = timelineData.tracks.flatMap((track: any) => track.assets || [])
    }

    if (timelineAssets.length > 0) {
      const sortedAssets = timelineAssets.sort((a: any, b: any) =>
        (b.startTime || 0) - (a.startTime || 0)
      )

      const videoAssets = sortedAssets.filter((asset: any) => asset.type === 'video')
      if (videoAssets.length > 0) {
        const latestVideo = videoAssets[0]
        const videoUrl = latestVideo.content?.videoUrl || latestVideo.metadata?.resourceUrl
        if (videoUrl) {
          return {
            type: 'video',
            url: videoUrl,
            aspectRatio: latestVideo.content?.aspectRatio === '16:9' ? '16:9' : 'crop-16:9'
          }
        }
      }

      const imageAssets = sortedAssets.filter((asset: any) => asset.type === 'keyframe')
      if (imageAssets.length > 0) {
        const latestImage = imageAssets[0]
        const imageUrl = latestImage.content?.imageUrl || latestImage.metadata?.resourceUrl
        if (imageUrl) {
          return {
            type: 'image',
            url: imageUrl,
            aspectRatio: 'auto'
          }
        }
      }

      const audioAssets = sortedAssets.filter((asset: any) => asset.type === 'audio')
      if (audioAssets.length > 0) {
        const latestAudio = audioAssets[0]
        const audioUrl = latestAudio.content?.audioUrl || latestAudio.metadata?.resourceUrl
        if (audioUrl) {
          return {
            type: 'audio',
            url: audioUrl,
            aspectRatio: 'auto'
          }
        }
      }
    }

    const allElements = [
      ...(canvas.data?.elements || []),
      ...(canvas.data?.data?.elements || []),
      ...(canvas.data?.data?.data?.elements || [])
    ]

    const allFiles = {
      ...(canvas.data?.files || {}),
      ...(canvas.data?.data?.files || {}),
      ...(canvas.data?.data?.data?.files || {})
    }

    if (allElements.length === 0 || Object.keys(allFiles).length === 0) {
      return { type: 'none', url: canvas.thumbnail }
    }

    const elements = allElements
    const files = allFiles

    const videoElements = elements
      .filter((el: any) =>
        el.type === 'video' ||
        (el.type === 'image' && (el.isVideo || el.videoUrl))
      )
      .sort((a: any, b: any) => (b.updated || b.created || 0) - (a.updated || a.created || 0))

    const audioElements = elements
      .filter((el: any) =>
        el.type === 'audio' ||
        (el.type === 'image' && (el.isAudio || el.audioUrl))
      )
      .sort((a: any, b: any) => (b.updated || b.created || 0) - (a.updated || a.created || 0))

    const imageElements = elements
      .filter((el: any) =>
        el.type === 'image' &&
        !el.isVideo &&
        !el.isAudio &&
        !el.videoUrl &&
        !el.audioUrl
      )
      .sort((a: any, b: any) => (b.updated || b.created || 0) - (a.updated || a.created || 0))

    const video16x9 = videoElements.find((el: any) => {
      const aspectRatio = el.width / el.height
      return Math.abs(aspectRatio - (16 / 9)) < 0.1
    })

    if (video16x9) {
      const videoUrl = video16x9.videoUrl || (video16x9.fileId && files[video16x9.fileId]?.dataURL)
      if (videoUrl) {
        return {
          type: 'video',
          url: videoUrl,
          aspectRatio: '16:9'
        }
      }
    }

    if (videoElements.length > 0) {
      const firstVideo = videoElements[0]
      const videoUrl = firstVideo.videoUrl || (firstVideo.fileId && files[firstVideo.fileId]?.dataURL)
      if (videoUrl) {
        return {
          type: 'video',
          url: videoUrl,
          aspectRatio: 'crop-16:9'
        }
      }
    }

    if (audioElements.length > 0) {
      const firstAudio = audioElements[0]
      const audioUrl = firstAudio.audioUrl || (firstAudio.fileId && files[firstAudio.fileId]?.dataURL)
      if (audioUrl) {
        return {
          type: 'audio',
          url: audioUrl,
          aspectRatio: 'auto'
        }
      }
    }

    if (imageElements.length > 0) {
      const firstImage = imageElements[0]
      const imageUrl = firstImage.fileId && files[firstImage.fileId]?.dataURL
      if (imageUrl) {
        return {
          type: 'image',
          url: imageUrl,
          aspectRatio: 'auto'
        }
      }
    }

    return { type: 'thumbnail', url: canvas.thumbnail }
  }, [canvas.data, canvas.thumbnail])

  const handleDelete = async () => {
    if (isDeleting) return

    setIsDeleting(true)
    try {
      await deleteCanvas(canvas.id)
      handleDeleteCanvas(canvas.id)
      toast.success(t('canvas:messages.canvasDeleted'))
    } catch (error) {
      toast.error(t('canvas:messages.failedToDelete'))
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.6,
        delay: index * 0.1,
        ease: [0.4, 0, 0.2, 1]
      }}
      whileHover={{
        y: -4,
        transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }
      }}
      onHoverStart={() => {
        router.prefetch(canvasPath)
      }}
      className="group relative cursor-pointer overflow-hidden rounded-[1.6rem] border border-white/34 bg-white/26 shadow-[0_18px_52px_rgba(0,0,0,0.09)] backdrop-blur-[24px] transition-all duration-300 hover:bg-white/34 hover:shadow-[0_24px_64px_rgba(0,0,0,0.12)] active:scale-[0.98] dark:border-white/[0.06] dark:bg-transparent dark:shadow-[0_22px_60px_rgba(0,0,0,0.22)] dark:hover:bg-white/[0.018]"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 z-20 h-8 w-8 rounded-full border border-white/30 bg-white/72 text-neutral-600 opacity-0 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-all duration-200 hover:bg-white hover:text-neutral-900 group-hover:opacity-100 dark:border-white/[0.08] dark:bg-white/[0.024] dark:text-white/62 dark:hover:bg-white/[0.16] dark:hover:text-white"
        onClick={(e) => {
          e.stopPropagation()
          setShowDeleteDialog(true)
        }}
        disabled={isDeleting}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div
        className="relative z-10 flex flex-col gap-3 p-4"
        onClick={() => handleCanvasClick(canvas.id, canvasPath)}
      >
        {coverMedia.url ? (
          <div className="relative overflow-hidden rounded-[1.15rem] border border-white/24 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-transform duration-300 group-hover:scale-[1.02] dark:border-white/[0.07]">
            {coverMedia.type === 'video' ? (
              <>
                <video
                  src={coverMedia.url}
                  className={`w-full h-40 ${coverMedia.aspectRatio === 'crop-16:9'
                    ? 'object-cover object-top' // 裁切顶部显示16:9
                    : 'object-cover'
                    }`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
                <div className="absolute right-2 top-2 rounded-full border border-white/30 bg-white/72 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.16)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.024]">
                  <PlayIcon className="h-4 w-4 text-neutral-900 dark:text-white" />
                </div>
              </>
            ) : coverMedia.type === 'audio' ? (
              <>
                <div className="flex h-40 w-full items-center justify-center bg-white/20 dark:bg-transparent">
                  <div className="text-center">
                    <Volume2 className="mx-auto mb-2 h-12 w-12 text-neutral-400 dark:text-white/34" />
                    <p className="text-sm text-neutral-500 dark:text-white/46">Audio Content</p>
                  </div>
                </div>
                <div className="absolute right-2 top-2 rounded-full border border-white/30 bg-white/72 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.16)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.024]">
                  <Volume2 className="h-4 w-4 text-neutral-900 dark:text-white" />
                </div>
              </>
            ) : (
              <img
                src={coverMedia.url}
                alt={canvas.name}
                className="w-full h-40 object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const parent = e.currentTarget.parentElement
                  if (parent) {
                    parent.innerHTML = `
                      <div class="w-full h-40 bg-white/18 dark:bg-transparent rounded-lg flex items-center justify-center border border-white/18 dark:border-white/[0.06]">
                        <svg class="w-12 h-12 text-neutral-400 dark:text-white/34" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                      </div>
                    `
                  }
                }}
              />
            )}

          </div>
        ) : (
          <div className="flex h-40 w-full items-center justify-center rounded-[1.15rem] border border-white/24 bg-white/20 transition-all duration-300 group-hover:border-white/36 dark:border-white/[0.06] dark:bg-transparent dark:group-hover:border-white/[0.1]">
            <ImageIcon className="h-12 w-12 text-neutral-400 dark:text-white/34" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h3 className="truncate text-lg font-semibold text-neutral-900 transition-colors duration-300 group-hover:text-neutral-950 dark:text-white/92 dark:group-hover:text-white">
            {canvas.name}
          </h3>
          <p className="text-sm text-neutral-600 dark:text-white/54">
            {formatDate(canvas.created_at, i18n.language)}
          </p>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <CanvasDeleteDialog
        show={showDeleteDialog}
        setShow={setShowDeleteDialog}
        handleDeleteCanvas={handleDelete}
        deleting={isDeleting}
      />
    </motion.div>
  )
}

export default CanvasCard
