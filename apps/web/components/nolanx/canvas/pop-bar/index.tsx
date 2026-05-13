import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import { TCanvasAddImagesToChatEvent } from '@/lib/nolanx/utils/event'
import { ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import { AnimatePresence } from 'motion/react'
import { useRef, useState, useEffect } from 'react'
import CanvasPopbar from './CanvasPopbar'

const CanvasPopbarWrapper = () => {
  const { excalidrawAPI } = useCanvas()

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const selectedImagesRef = useRef<TCanvasAddImagesToChatEvent>([])

  useEffect(() => {
    if (!excalidrawAPI) return

    const handleChange = (elements: any, appState: any, files: any) => {
      const selectedIds = appState.selectedElementIds
      if (Object.keys(selectedIds).length === 0) {
        setPos(null)
        return
      }

      const selectedImages = elements.filter(
        (element: any) => element.type === 'image' && selectedIds[element.id]
      ) as ExcalidrawImageElement[]
      if (selectedImages.length === 0) {
        setPos(null)
        return
      }

      selectedImagesRef.current = selectedImages
        .filter((image) => image.fileId)
        .map((image) => {
          const file = files[image.fileId!]
          const isBase64 = file.dataURL.startsWith('data:')

          if (isBase64) {
            // Base64图片，需要上传
            return {
              fileId: file.id,
              base64: file.dataURL,
              width: image.width,
              height: image.height,
            }
          } else {
            // 已经是Cloudflare公网URL，直接使用
            return {
              fileId: image.fileId!,
              url: file.dataURL, // 直接使用dataURL，它就是Cloudflare的公网URL
              width: image.width,
              height: image.height,
            }
          }
        })

      const centerX =
        selectedImages.reduce(
          (acc, image) => acc + image.x + image.width / 2,
          0
        ) / selectedImages.length

      const bottomY = selectedImages.reduce(
        (acc, image) => Math.max(acc, image.y + image.height),
        0
      )

      const scrollX = appState.scrollX
      const scrollY = appState.scrollY
      const zoom = appState.zoom.value
      const offsetX = (scrollX + centerX) * zoom
      const offsetY = (scrollY + bottomY) * zoom
      setPos({ x: offsetX, y: offsetY })
    }

    excalidrawAPI.onChange(handleChange)
  }, [excalidrawAPI])

  return (
    <div className="absolute left-0 bottom-0 w-full h-full z-20 pointer-events-none">
      <AnimatePresence>
        {pos && (
          <CanvasPopbar pos={pos} selectedImages={selectedImagesRef.current} />
        )}
      </AnimatePresence>
    </div>
  )
}

export default CanvasPopbarWrapper
