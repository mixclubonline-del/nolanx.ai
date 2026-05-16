import { cancelChat } from '@/lib/nolanx/api/chat'
import { uploadGenerationImage } from '@/lib/upload'
import { eventBus, TCanvasAddImagesToChatEvent } from '@/lib/nolanx/utils/event'
import { cn, dataURLToFile } from '@/lib/nolanx/utils/utils'
import { Message } from '@/lib/nolanx/types/types'
import { useMutation } from '@tanstack/react-query'
import { useDrop } from 'ahooks'
import { produce } from 'immer'
import { ArrowUp, Loader2, PlusIcon, Square, XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Textarea, { TextAreaRef } from 'rc-textarea'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { toast } from 'sonner'
import '@/styles/nolanx/nolan-dreamlike-chat.css'

type ChatTextareaProps = {
  pending: boolean
  className?: string
  messages: Message[]
  sessionId?: string
  initialPrompt?: string
  autoSend?: boolean
  showSleepButton?: boolean
  queuedMessageCount?: number
  onSendMessages: (
    data: Message[],
  ) => void
  onCancelChat?: () => void
}

const ChatTextarea: React.FC<ChatTextareaProps> = ({
  pending,
  className,
  messages,
  sessionId,
  initialPrompt,
  autoSend = false,
  showSleepButton = false,
  queuedMessageCount = 0,
  onSendMessages,
  onCancelChat,
}) => {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const textareaRef = useRef<TextAreaRef>(null)
  const [images, setImages] = useState<
    {
      file_id: string
      url: string
      width: number
      height: number
    }[]
  >([])
  const [uploadingImages, setUploadingImages] = useState<
    {
      file_id: string
      fileName: string
      progress: number
    }[]
  >([])
  const [isFocused, setIsFocused] = useState(false)
  const [isSleeping, setIsSleeping] = useState(false)
  const [isSleepHintHovered, setIsSleepHintHovered] = useState(false)
  const hasDraftContent = prompt.trim().length > 0 || images.length > 0
  const defaultPlaceholderText = t('chat:textarea.placeholder')
  const sleepHintText = 'You could sleep screen or enjoy your free time while nolanx is stilling working'
  const placeholderText = isSleepHintHovered ? sleepHintText : defaultPlaceholderText

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim() !== '') {
      setPrompt(initialPrompt.trim())
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [initialPrompt])

  const imageInputRef = useRef<HTMLInputElement>(null)

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const { mutate: uploadImageMutation } = useMutation({
    mutationFn: async (file: File) => {
      const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

      setUploadingImages(prev => [...prev, {
        file_id: fileId,
        fileName: file.name,
        progress: 0
      }])

      try {
        const updateProgress = (progress: number) => {
          setUploadingImages(prev =>
            prev.map(item =>
              item.file_id === fileId
                ? { ...item, progress }
                : item
            )
          )
        }

        updateProgress(10)

        const publicUrl = await uploadGenerationImage(file)
        updateProgress(70)

        const dimensions = await getImageDimensions(file)
        updateProgress(100)

        setUploadingImages(prev => prev.filter(item => item.file_id !== fileId))

        return {
          file_id: fileId,
          url: publicUrl,
          width: dimensions.width,
          height: dimensions.height,
        }
      } catch (error) {
        setUploadingImages(prev => prev.filter(item => item.file_id !== fileId))
        throw error
      }
    },
    onSuccess: (data) => {
      console.log('ðŸ¦„uploadImageMutation onSuccess', data)
      setImages((prev) => [
        ...prev,
        {
          file_id: data.file_id,
          url: data.url,
          width: data.width,
          height: data.height,
        },
      ])
    },
    onError: (error) => {
      console.error('Upload failed:', error)
      toast.error(t('chat:textarea.uploadFailed'))
    },
  })

  const handleImagesUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files) {
        if (uploadingImages.length >= 3) {
          toast.error(t('chat:textarea.waitForUploads'))
          return
        }

        for (const file of files) {
          if (!file.type.startsWith('image/')) {
            toast.error(t('chat:textarea.invalidFileType', { fileName: file.name }))
            continue
          }

          if (file.size > 10 * 1024 * 1024) {
            toast.error(t('chat:textarea.fileTooLarge', { fileName: file.name }))
            continue
          }

          uploadImageMutation(file)
        }
      }

      if (e.target) {
        e.target.value = ''
      }
    },
    [uploadImageMutation, uploadingImages.length, t]
  )

  const handleCancelChat = useCallback(async () => {
    try {
      if (sessionId) {
        await cancelChat(sessionId)
      }
      toast.success(t('common:actions.cancel', { defaultValue: 'Cancelled' }))
    } catch (error) {
      console.error('Failed to cancel chat:', error)
      toast.error(t('common:errors.generic', { defaultValue: 'Something went wrong. Please try again later.' }))
    } finally {
      onCancelChat?.()
    }
  }, [sessionId, onCancelChat, t])

  const handleSendPrompt = useCallback(() => {
    let value = prompt
    if (value.length === 0 || value.trim() === '') {
      toast.error(t('chat:textarea.enterPrompt'))
      return
    }

    if (images.length > 0) {
      images.forEach((image) => {
        value += `\n\n ![image_url: ${image.url}](${image.url})`
      })
    }

    const newMessage = messages.concat([
      {
        role: 'user',
        content: value,
      },
    ])
    setImages([])
    setPrompt('')

    onSendMessages(newMessage)
  }, [
    prompt,
    onSendMessages,
    images,
    messages,
    t,
  ])

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim() !== '' && autoSend && prompt === initialPrompt.trim()) {
      const timer = setTimeout(() => {
        let value = prompt
        if (value.length === 0 || value.trim() === '') {
          return
        }

        if (images.length > 0) {
          images.forEach((image) => {
            value += `\n\n ![image_url: ${image.url}](${image.url})`
          })
        }

        const newMessage = messages.concat([
          {
            role: 'user',
            content: value,
          },
        ])
        setImages([])
        setPrompt('')

        onSendMessages(newMessage)
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [initialPrompt, autoSend, prompt, images, messages, onSendMessages])

  const dropAreaRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFilesDrop = useCallback(
    (files: File[]) => {
      if (uploadingImages.length >= 3) {
        toast.error(t('chat:textarea.waitForUploads'))
        return
      }

      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          toast.error(t('chat:textarea.invalidFileType', { fileName: file.name }))
          continue
        }
        uploadImageMutation(file)
      }
    },
    [uploadImageMutation, uploadingImages.length, t]
  )

  useDrop(dropAreaRef, {
    onDragOver() {
      setIsDragOver(true)
    },
    onDragLeave() {
      setIsDragOver(false)
    },
    onDrop() {
      setIsDragOver(false)
    },
    onFiles: handleFilesDrop,
  })

  useEffect(() => {
    const handleAddImagesToChat = (data: TCanvasAddImagesToChatEvent) => {
      data.forEach(async (image) => {
        if (image.base64) {
          const file = dataURLToFile(image.base64, image.fileId)
          uploadImageMutation(file)
        } else if (image.url) {
          setImages(
            produce((prev) => {
              prev.push({
                file_id: image.fileId,
                url: image.url!,
                width: image.width,
                height: image.height,
              })
            })
          )
        } else {
          console.warn('Image has no URL, this should not happen in the new architecture')
          setImages(
            produce((prev) => {
              prev.push({
                file_id: image.fileId,
                url: `/api/file/${image.fileId}`,
                width: image.width,
                height: image.height,
              })
            })
          )
        }
      })

      textareaRef.current?.focus()
    }
    eventBus.on('Canvas::AddImagesToChat', handleAddImagesToChat)
    return () => {
      eventBus.off('Canvas::AddImagesToChat', handleAddImagesToChat)
    }
  }, [uploadImageMutation])

  return (
    <div className="nolan-chat-container">
      <motion.div
        ref={dropAreaRef}
        className={cn(
          'nolan-chat-box',
          isFocused && 'focused',
          className
        )}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        onClick={() => textareaRef.current?.focus()}
      >
        <AnimatePresence>
          {isDragOver && (
            <motion.div
              className="nolan-drag-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
            >
              <p className="text-sm font-medium">
                {t('chat:textarea.dropImagesHere')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {uploadingImages.length > 0 && (
            <motion.div
              className="nolan-image-area"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
            >
              {uploadingImages.map((uploadingImage) => (
                <motion.div
                  key={uploadingImage.file_id}
                  className="nolan-upload-progress"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.6, ease: 'easeInOut' }}
                >
                  <div className="relative size-6">
                    <svg className="nolan-progress-ring size-6" viewBox="0 0 24 24">
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        className="text-gray-300 dark:text-gray-600"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray={`${2 * Math.PI * 10}`}
                        strokeDashoffset={`${2 * Math.PI * 10 * (1 - uploadingImage.progress / 100)}`}
                        className="text-orange-500 transition-all duration-500"
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        {uploadingImage.progress}%
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {images.length > 0 && (
            <motion.div
              className="nolan-image-area"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
            >
              {images.map((image) => (
                <motion.div
                  key={image.file_id}
                  className="nolan-image-preview"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.6, ease: 'easeInOut' }}
                >
                  <img
                    src={image.url}
                    alt={t('chat:textarea.uploadedImageAlt')}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  <button
                    className="nolan-image-remove-btn"
                    onClick={() =>
                      setImages((prev) =>
                        prev.filter((i) => i.file_id !== image.file_id)
                      )
                    }
                  >
                    <XIcon className="size-2.5 text-white" />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="nolan-textarea-shell">
          <Textarea
            ref={textareaRef}
            className="nolan-textarea max-h-[calc(100vh-700px)]"
            placeholder=""
            value={prompt}
            autoSize
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendPrompt()
              }
            }}
          />
          <AnimatePresence mode="wait" initial={false}>
            {prompt.length === 0 ? (
              <motion.div
                key={placeholderText}
                className="nolan-placeholder-fade"
                initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {placeholderText}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="nolan-controls">
          <div className="flex items-center gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImagesUpload}
              hidden
            />
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImages.length > 0}
              className="nolan-upload-button"
            >
              {uploadingImages.length > 0 ? (
                <Loader2 className="size-4 nolan-loading-spinner" />
              ) : (
                <PlusIcon className="size-4" />
              )}
            </button>
          </div>

          {showSleepButton ? (
            <div className="absolute right-0 top-0 z-20 overflow-visible">
              <button
                type="button"
                aria-label="Sleep screen"
                onClick={() => setIsSleeping((value) => !value)}
                onMouseEnter={() => setIsSleepHintHovered(true)}
                onMouseLeave={() => setIsSleepHintHovered(false)}
                onFocus={() => setIsSleepHintHovered(true)}
                onBlur={() => setIsSleepHintHovered(false)}
                className={cn(
                  'group absolute right-2 top-2 h-6 w-6 overflow-visible bg-transparent transition-all duration-300',
                  isSleeping && 'opacity-100'
                )}
              >
                <span
                  className={cn(
                    'absolute right-0 top-0 h-full w-full rounded-tr-full border-r-[4px] border-t-[4px] border-white/25 transition-all duration-300',
                    isSleeping && 'border-white/55'
                  )}
                />
              </button>
            </div>
          ) : null}

          {pending ? (
            hasDraftContent ? (
              <button
                className={cn('nolan-button', queuedMessageCount > 0 && 'ring-1 ring-white/30')}
                onClick={handleSendPrompt}
              >
                <ArrowUp className="size-4" />
              </button>
            ) : (
              <button
                className="nolan-button bg-red-500 hover:bg-red-600"
                onClick={handleCancelChat}
              >
                <Loader2 className="size-5 nolan-loading-spinner absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                <Square className="size-2 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </button>
            )
          ) : (
            <button
              className={cn('nolan-button', queuedMessageCount > 0 && 'ring-1 ring-white/30')}
              onClick={handleSendPrompt}
              disabled={prompt.length === 0}
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
        {queuedMessageCount > 0 ? (
          <div className="mt-2 flex items-center justify-end">
            <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-medium text-white/70 backdrop-blur-md">
              {queuedMessageCount === 1
                ? 'Messages to be submitted after next tool call'
                : `${queuedMessageCount} messages to be submitted after next tool call`}
            </span>
          </div>
        ) : null}
    </motion.div>
    </div>
  )
}

export default ChatTextarea
export { ChatTextarea }
