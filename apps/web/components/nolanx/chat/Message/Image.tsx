import { Button } from '../../ui/button'
import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { PhotoView } from 'react-photo-view'

type MessageImageProps = {
  content: {
    image_url: {
      url: string
    }
    type: 'image_url'
  }
}

const MessageImage = ({ content }: MessageImageProps) => {
  const { excalidrawAPI } = useCanvas()
  const files = excalidrawAPI?.getFiles()
  const filesArray = Object.keys(files || {}).map((key) => ({
    id: key,
    url: files![key].dataURL,
  }))

  const { t } = useTranslation()

  const handleImagePositioning = (id: string) => {
    excalidrawAPI?.scrollToContent(id, { animate: true })
  }
  const id = filesArray.find((file) =>
    content.image_url.url?.includes(file.url)
  )?.id

  return (
    <div className="mb-6 w-full max-w-full min-w-0">
      <PhotoView src={content.image_url.url}>
        <div className="relative group cursor-pointer">
          <img
            className="h-auto w-full rounded-lg border border-white/24 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md dark:border-white/[0.06]"
            src={content.image_url.url}
            alt="Image"
          />

          {id && (
            <Button
              variant="secondary"
              className="absolute top-3 right-3 z-10 rounded-md border border-white/24 bg-white/88 px-3 py-1.5 text-xs font-medium opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-white group-hover:opacity-100 dark:border-white/[0.06] dark:bg-white/[0.024] dark:hover:bg-white/[0.04]"
              onClick={(e) => {
                e.stopPropagation()
                handleImagePositioning(id)
              }}
            >
              {t('chat:messages.imagePositioning')}
            </Button>
          )}
        </div>
      </PhotoView>
    </div>
  )
}

export default MessageImage
