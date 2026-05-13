import { eventBus } from '@/lib/nolanx/utils/event'
import { TEvents } from '@/lib/nolanx/utils/event'
import { useEffect } from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, AlertTriangle, Eye } from 'lucide-react'
import { PendingType } from '@/lib/nolanx/types/types'

type ReviewFeedItem = {
  layer: string
  status: string
  score?: number
  summary: string
}

function normalizeProgressText(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  const evenLength = normalized.length % 2 === 0
  if (evenLength) {
    const half = normalized.length / 2
    const left = normalized.slice(0, half).trim()
    const right = normalized.slice(half).trim()
    if (left && left === right) {
      return left
    }
  }

  const sentenceParts = normalized
    .split(/(?<=[.!?。！？])\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (sentenceParts.length >= 2) {
    const deduped: string[] = []
    for (const part of sentenceParts) {
      if (deduped.at(-1) !== part) {
        deduped.push(part)
      }
    }
    return deduped.join(' ')
  }

  return normalized
}

export default function ToolcallProgressUpdate({
  sessionId,
  pending,
}: {
  sessionId: string
  pending?: PendingType
}) {
  const [progress, setProgress] = useState('')
  const [progressLog, setProgressLog] = useState<string[]>([])
  const [reviewFeed, setReviewFeed] = useState<ReviewFeedItem[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const handleToolCallProgress = (
      data: TEvents['Socket::Session::ToolCallProgress']
    ) => {
      if (data.session_id === sessionId) {
        const update = normalizeProgressText(data.update || '')
        if (!update || update === 'Timeline analysis complete.') {
          setProgress('')
          if (!update) {
            setProgressLog([])
          }
          return
        }
        setProgress(update)
        setProgressLog((prev) => {
          if (prev.at(-1) === update) {
            return prev
          }
          const next = [...prev, update]
          return next.slice(-12)
        })
      }
    }

    const handleReview = (data: TEvents['Socket::Session::Review']) => {
      if (data.session_id !== sessionId) {
        return
      }
      setReviewFeed((prev) => {
        const next = [
          {
            layer: data.layer,
            status: data.status,
            score: data.score,
            summary: data.summary,
          },
          ...prev,
        ]
        return next.slice(0, 8)
      })
    }

    eventBus.on('Socket::Session::ToolCallProgress', handleToolCallProgress)
    eventBus.on('Socket::Session::Review', handleReview)
    return () => {
      eventBus.off('Socket::Session::ToolCallProgress', handleToolCallProgress)
      eventBus.off('Socket::Session::Review', handleReview)
    }
  }, [sessionId])

  useEffect(() => {
    if (!pending) {
      setProgress('')
      setProgressLog([])
      setReviewFeed([])
      setExpanded(false)
    }
  }, [pending])

  if (!progress && !pending && !progressLog.length && !reviewFeed.length) return null

  const liveSummary =
    progress ||
    reviewFeed[0]?.summary ||
    (pending ? 'Waiting for the next planning event' : 'Live feed is up to date')
  const visibleProgressLog = progressLog
    .filter((item, index, list) => item !== progress && item !== list[index - 1])
    .slice()
    .reverse()

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-[1rem] border border-white/24 bg-white/24 px-3 py-2 text-left text-[11px] text-black/55 transition-colors hover:bg-white/34 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-white/58 dark:hover:bg-white/[0.03]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium tracking-[0.01em]">
            {pending || progress ? <Loader2 className="h-3 w-3 animate-spin text-orange-500" /> : null}
            <span>Live Feed</span>
          </div>
          <div className="truncate text-[10px] text-black/40 dark:text-white/40">
            {liveSummary}
          </div>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>

      {expanded ? (
        <div className="rounded-[1.2rem] border border-white/24 bg-white/20 px-3 py-2 text-[11px] text-black/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:border-white/[0.06] dark:bg-white/[0.018] dark:text-white/60">
          <div className="space-y-1.5">
            {progress ? (
              <div className="flex items-start gap-2 rounded-lg bg-white/62 px-2 py-1.5 text-black/62 dark:bg-white/[0.02] dark:text-white/64">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-orange-500" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-black/38 dark:text-white/38">
                    Current
                  </div>
                  <div className="text-[11px] text-black/62 dark:text-white/64">
                    {progress}
                  </div>
                </div>
              </div>
            ) : null}
            {visibleProgressLog.map((item, index) => (
              <div key={`${item}-${index}`} className="rounded-lg bg-white/52 px-2 py-1.5 text-black/58 dark:bg-white/[0.018] dark:text-white/58">
                {item}
              </div>
            ))}
            {reviewFeed.map((item, index) => (
              <div key={`${item.layer}-${index}`} className="flex items-start gap-2 rounded-lg bg-white/62 px-2 py-1.5 dark:bg-white/[0.02]">
                <div className="mt-0.5 shrink-0">
                  {item.status === 'approved_auto' ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  ) : item.status === 'attention_needed' ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-black/38 dark:text-white/38">
                    {item.layer} {typeof item.score === 'number' ? `· ${item.score}` : ''}
                  </div>
                  <div className="text-black/60 dark:text-white/64">{item.summary}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
