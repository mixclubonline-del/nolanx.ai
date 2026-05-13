import { ToolResultMessage } from '@/lib/nolanx/types/types'
import { AnimatePresence, motion } from 'motion/react'
import { Markdown } from '../Markdown'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import CodeViewer from '../CodeViewer'
import JsonCard from '../JsonCard'
import { isScriptPayload } from '../ScriptCard'
import TextFoldTag from './TextFoldTag'
import { getFoldLabel, shouldFoldChatMessage } from '../message-folding'
import { stripUiVisibilityTags } from './visibility'

type ToolCallContentProps = {
  expandingToolCalls: string[]
  message: ToolResultMessage
}

type ParsedToolError = {
  title: string
  httpStatus?: number
  code?: number
  message?: string
  path?: string
  rawJson?: any
}

const ToolCallContent: React.FC<ToolCallContentProps> = ({
  expandingToolCalls,
  message,
}) => {
  const isExpanded = expandingToolCalls.includes(message.tool_call_id)
  const displayContent = useMemo(
    () => stripUiVisibilityTags(String(message.content || '')),
    [message.content],
  )

  const parsedError = useMemo<ParsedToolError | null>(() => {
    const text = displayContent.trim()
    if (!text) return null
    const looksLikeError =
      /\bfailed\b/i.test(text) ||
      /\berror\b/i.test(text) ||
      text.startsWith('❌') ||
      /HTTP\s+\d{3}/i.test(text)
    if (!looksLikeError) return null

    const httpMatch = text.match(/HTTP\s+(\d{3})/i)
    const httpStatus = httpMatch ? Number(httpMatch[1]) : undefined

    const title = (text.split('\n')[0] || '').split(':')[0].trim() || 'Error'

    const extractLastJsonObject = (input: string): string | null => {
      let depth = 0
      let start = -1
      let last: string | null = null
      for (let i = 0; i < input.length; i++) {
        const ch = input[i]
        if (ch === '{') {
          if (depth === 0) start = i
          depth++
        } else if (ch === '}') {
          if (depth > 0) depth--
          if (depth === 0 && start !== -1) {
            last = input.slice(start, i + 1)
            start = -1
          }
        }
      }
      return last
    }

    const jsonText = extractLastJsonObject(text)
    if (!jsonText) {
      return { title, httpStatus, message: text }
    }

    try {
      const parsed = JSON.parse(jsonText)
      return {
        title,
        httpStatus,
        code: typeof parsed?.code === 'number' ? parsed.code : undefined,
        message: typeof parsed?.message === 'string' ? parsed.message : undefined,
        path: typeof parsed?.path === 'string' ? parsed.path : undefined,
        rawJson: parsed,
      }
    } catch (e) {
      return { title, httpStatus, message: text }
    }
  }, [displayContent])

  const scriptPayload = useMemo(() => {
    const text = displayContent.trim()
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      return isScriptPayload(parsed) ? { value: parsed, raw: text } : null
    } catch {
      return null
    }
  }, [displayContent])

  const [showDetails, setShowDetails] = useState(false)
  const [isFoldExpanded, setIsFoldExpanded] = useState(false)
  const shouldFold = useMemo(
    () => !parsedError && shouldFoldChatMessage(displayContent),
    [displayContent, parsedError],
  )
  const foldLabel = useMemo(() => getFoldLabel(displayContent), [displayContent])

  return (
    <AnimatePresence>
      {(isExpanded || scriptPayload) && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          layout
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mb-3 w-full max-w-full min-w-0 overflow-x-hidden rounded-[1.6rem] border border-white/34 bg-white/24 p-3 text-sm leading-relaxed text-neutral-800 shadow-[0_16px_44px_rgba(0,0,0,0.08)] backdrop-blur-[22px] dark:border-white/[0.06] dark:bg-transparent dark:text-white/82 dark:shadow-[0_20px_56px_rgba(0,0,0,0.24)]"
        >
          {scriptPayload ? (
            <JsonCard value={scriptPayload.value} raw={scriptPayload.raw} />
          ) : parsedError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 p-3 w-full max-w-full min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-red-800 dark:text-red-200 break-words">
                    {parsedError.title}
                    {Number.isFinite(parsedError.httpStatus) ? ` (HTTP ${parsedError.httpStatus})` : ''}
                  </div>
                  {parsedError.message && (
                    <div className="text-sm text-red-700 dark:text-red-300 break-words mt-1">
                      {parsedError.message}
                    </div>
                  )}
                  {(parsedError.code || parsedError.path) && (
                    <div className="text-xs text-red-700/80 dark:text-red-300/80 mt-2 break-words">
                      {parsedError.code ? `code: ${parsedError.code}` : ''}
                      {parsedError.code && parsedError.path ? ' · ' : ''}
                      {parsedError.path ? `path: ${parsedError.path}` : ''}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="mt-3 text-xs font-medium text-red-700 dark:text-red-300 hover:underline inline-flex items-center gap-1"
              >
                {showDetails ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    Details
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    Details
                  </>
                )}
              </button>

              {showDetails && (
                <div className="mt-2">
                  {parsedError.rawJson && typeof parsedError.rawJson === 'object' ? (
                    <JsonCard
                      value={parsedError.rawJson}
                      raw={JSON.stringify(parsedError.rawJson, null, 2)}
                      defaultExpandedDepth={1}
                    />
                  ) : (
                    <CodeViewer code={displayContent} language="text" />
                  )}
                </div>
              )}
            </div>
          ) : (
            shouldFold ? (
              <TextFoldTag
                isExpanded={isFoldExpanded}
                onToggleExpand={() => setIsFoldExpanded((prev) => !prev)}
                buttonText={foldLabel}
              >
                <Markdown>{displayContent}</Markdown>
              </TextFoldTag>
            ) : (
              <Markdown>{displayContent}</Markdown>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ToolCallContent
