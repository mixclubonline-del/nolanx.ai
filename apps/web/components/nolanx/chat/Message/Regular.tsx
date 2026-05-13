import { useMemo, useState } from 'react'
import { Message, MessageContent } from '@/lib/nolanx/types/types'
import { Markdown } from '../Markdown'
import MessageImage from './Image'
import MessageAudio from './Audio'
import TextFoldTag from './TextFoldTag'
import { getFoldLabel, shouldFoldChatMessage } from '../message-folding'
import { stripUiVisibilityTags } from './visibility'

type MessageRegularProps = {
  message: Message
  content: MessageContent | string
}

const MessageRegular: React.FC<MessageRegularProps> = ({
  message,
  content,
}) => {
  const isUser = message.role === 'user'
  const [isFoldExpanded, setIsFoldExpanded] = useState(false)
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)
  const isStrContent = typeof content === 'string'
  const isText = isStrContent || (!isStrContent && content.type == 'text')
  const isAudio = !isStrContent && content.type === 'audio_url'

  const rawMarkdownText = isStrContent ? content : (content.type === 'text' ? content.text : '')
  const markdownText = stripUiVisibilityTags(rawMarkdownText)
  const shouldFold = useMemo(
    () => message.role !== 'user' && shouldFoldChatMessage(markdownText),
    [markdownText, message.role],
  )
  const foldLabel = useMemo(() => getFoldLabel(markdownText), [markdownText])

  if (isAudio && !isStrContent) return <MessageAudio content={content} />
  if (!isText && !isStrContent && content.type === 'image_url') {
    return <MessageImage content={content} />
  }

  if (shouldFold) {
    return (
      <div className="w-full max-w-full min-w-0">
        <TextFoldTag
          isExpanded={isFoldExpanded}
          onToggleExpand={() => setIsFoldExpanded((prev) => !prev)}
          buttonText={foldLabel}
          onOpenFullscreen={() => setIsFullscreenOpen(true)}
        >
          <div className="leading-relaxed w-full max-w-full min-w-0 overflow-x-hidden">
            <Markdown>{markdownText}</Markdown>
          </div>
        </TextFoldTag>
        {isFullscreenOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
            <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.22),rgba(12,12,11,0.16))]">
              <div className="flex items-center justify-between border-b border-black/8 px-4 py-3 dark:border-white/[0.06]">
                <div className="text-sm font-semibold text-black/85 dark:text-white/88">{foldLabel}</div>
                <button
                  type="button"
                  onClick={() => setIsFullscreenOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-black/55 transition-colors hover:bg-black/5 hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[0.03] dark:hover:text-white/82"
                >
                  Close
                </button>
              </div>
              <div className="overflow-auto p-5 text-sm leading-7 text-black/78 dark:text-white/78">
                <Markdown>{markdownText}</Markdown>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`mb-3 flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'w-full max-w-[88%] min-w-0 rounded-[2rem] rounded-tr-[1rem] border border-orange-300/55 bg-gradient-to-br from-orange-500/88 via-orange-400/84 to-amber-400/80 px-5 py-4 text-white shadow-[0_20px_48px_rgba(249,115,22,0.22)] backdrop-blur-[22px] dark:border-orange-300/32 dark:from-orange-500/72 dark:via-orange-400/66 dark:to-amber-400/60'
            : 'w-full max-w-[84%] min-w-0 rounded-[2rem] rounded-tl-[1rem] border border-white/38 bg-white/30 px-5 py-4 text-neutral-900 shadow-[0_18px_52px_rgba(0,0,0,0.1)] backdrop-blur-[24px] dark:border-white/[0.06] dark:bg-transparent dark:text-white'
        }
      >
        <div className={`mb-3 flex items-center gap-2 text-[11px] font-medium tracking-[0.01em] ${isUser ? 'text-white/90' : 'text-neutral-700 dark:text-white/70'}`}>
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold backdrop-blur-sm ${isUser ? 'border-white/40 bg-white/18 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]' : 'border-white/45 bg-white/38 text-neutral-700 dark:border-white/[0.06] dark:bg-transparent dark:text-white/78'}`}>
            {isUser ? 'Y' : 'N'}
          </span>
          <span>{isUser ? 'You' : 'Nolan'}</span>
        </div>

        <div className={`leading-relaxed w-full max-w-full min-w-0 overflow-x-hidden text-[15px] ${isUser ? 'text-white' : 'text-neutral-900 dark:text-white/88'}`}>
          <Markdown>{markdownText}</Markdown>
        </div>
      </div>
    </div>
  )
}

export default MessageRegular
