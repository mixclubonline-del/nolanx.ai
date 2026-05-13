import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { ImageDown } from 'lucide-react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { toast } from 'sonner'
import { Button } from '../ui/button'

const CanvasExport = () => {
  const { excalidrawAPI } = useCanvas()
  const { t } = useTranslation()

  const downloadImage = async (imageUrl: string): Promise<string> => {
    const image = new Image()
    image.src = imageUrl
    return new Promise((resolve, reject) => {
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(image, 0, 0)
        const dataURL = canvas.toDataURL('image/png')
        resolve(dataURL)
      }
      image.onerror = () => {
        reject(new Error('Failed to load image'))
      }
    })
  }

  const handleExportImages = async () => {
    if (!excalidrawAPI) return
    const toastId = toast.loading(t('canvas:messages.exportingImages'))
    try {
      const appState = excalidrawAPI.getAppState()
      const elements = excalidrawAPI.getSceneElements()

      const selectedIds = Object.keys(appState.selectedElementIds).filter(
        (id) => appState.selectedElementIds[id]
      )

      const images = elements.filter(
        (element) =>
          selectedIds.includes(element.id) && element.type === 'image'
      )

      if (images.length === 0) {
        toast.error(t('canvas:messages.noImagesSelected'))
        return
      }

      const files = excalidrawAPI.getFiles()

      const imageUrls = images
        .map((image) => {
          if ('fileId' in image && image.fileId) {
            const file = files[image.fileId]
            return file?.dataURL
          }
          return null
        })
        .filter((url) => url !== null)

      if (imageUrls.length === 0) {
        toast.error(t('canvas:messages.noImagesSelected'))
        return
      }

      if (imageUrls.length === 1) {
        const imageUrl = imageUrls[0]
        const dataURL = await downloadImage(imageUrl)
        saveAs(dataURL, 'image.png')
      } else {
        const zip = new JSZip()
        await Promise.all(
          imageUrls.map(async (imageUrl, index) => {
            const dataURL = await downloadImage(imageUrl)
            if (dataURL) {
              zip.file(
                `image-${index}.png`,
                dataURL.replace('data:image/png;base64,', ''),
                { base64: true }
              )
            }
          })
        )
        const content = await zip.generateAsync({ type: 'blob' })
        saveAs(content, 'images.zip')
      }
    } catch (error) {
      toast.error(t('canvas:messages.failedToExportImages'), {
        id: toastId,
      })
    } finally {
      toast.dismiss(toastId)
    }
  }

  return (
    <div className="inline-flex -space-x-px rounded-md shadow-xs rtl:space-x-reverse">
      <Button
        className="rounded-none shadow-none first:rounded-s-md last:rounded-e-md h-8"
        variant="outline"
        onClick={handleExportImages}
      >
        <ImageDown />
        {t('canvas:exportImages')}
      </Button>
    </div>
  )
}

export default CanvasExport
