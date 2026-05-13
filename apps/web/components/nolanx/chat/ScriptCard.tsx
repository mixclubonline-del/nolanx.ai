"use client"

import React, { useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, Copy, FileText } from 'lucide-react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { cn } from '@/lib/nolanx/utils/utils'
import CodeViewer from './CodeViewer'

type ScriptCardProps = {
  value: Record<string, unknown>
  raw: string
  repeat?: number
  className?: string
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getScreenplayText(root: Record<string, unknown>): string {
  const screenplay = asObject(root.screenplay)
  return normalizeText(screenplay?.text ?? root.screenplay_text ?? root.script ?? root.screenplay)
}

function getScreenplaySummary(root: Record<string, unknown>): string {
  const screenplay = asObject(root.screenplay)
  return normalizeText(screenplay?.summary ?? root.summary)
}

function getVisualBible(root: Record<string, unknown>): Record<string, unknown> | null {
  return asObject(root.visual_bible)
}

function getStoryMetrics(root: Record<string, unknown>): Record<string, unknown> | null {
  return asObject(root.story_metrics)
}

function getBibleElements(root: Record<string, unknown>): unknown[] {
  const bible = asObject(root.bible)
  const elements = bible?.elements
  return Array.isArray(elements) ? elements : []
}

export function isScriptPayload(value: unknown): value is Record<string, unknown> {
  const root = asObject(value)
  if (!root) return false

  const screenplay = asObject(root.screenplay)
  const storyMetrics = asObject(root.story_metrics)
  const visualBible = asObject(root.visual_bible)

  return Boolean(
    typeof root.title === 'string' ||
    typeof root.premise === 'string' ||
    typeof screenplay?.text === 'string' ||
    typeof screenplay?.summary === 'string' ||
    storyMetrics ||
    visualBible,
  )
}

export default function ScriptCard({
  value,
  raw,
  repeat = 1,
  className,
}: ScriptCardProps) {
  const { t } = useTranslation()
  const [showScript, setShowScript] = useState(false)
  const [showMetrics, setShowMetrics] = useState(false)
  const [showVisualBible, setShowVisualBible] = useState(false)
  const [showBibleElements, setShowBibleElements] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const title = normalizeText(value.title) || 'Script'
  const premise = normalizeText(value.premise)
  const screenplayText = useMemo(() => getScreenplayText(value), [value])
  const screenplaySummary = useMemo(() => getScreenplaySummary(value), [value])
  const visualBible = useMemo(() => getVisualBible(value), [value])
  const storyMetrics = useMemo(() => getStoryMetrics(value), [value])
  const bibleElements = useMemo(() => getBibleElements(value), [value])

  const metricEntries = useMemo(() => {
    if (!storyMetrics) return []
    return Object.entries(storyMetrics).filter(([, metricValue]) =>
      ['string', 'number', 'boolean'].includes(typeof metricValue),
    )
  }, [storyMetrics])

  const visualEntries = useMemo(() => {
    if (!visualBible) return []
    return Object.entries(visualBible).filter(([, visualValue]) =>
      typeof visualValue === 'string' && visualValue.trim(),
    )
  }, [visualBible])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(screenplayText || raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <div
      className={cn(
        'not-prose w-full max-w-full min-w-0 overflow-hidden rounded-[1.2rem] border border-white/28 bg-white/30 dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.24),rgba(12,12,11,0.16))]',
        className,
      )}
    >
      <div className="h-0.5 bg-[linear-gradient(90deg,rgb(255,90,0),rgb(255,154,31))]" />

      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/28 dark:border-white/[0.06] bg-white/34 dark:bg-white/[0.024]">
                <BookOpen className="h-3.5 w-3.5 text-zinc-700 dark:text-zinc-200" />
              </span>
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Script</span>
              {repeat > 1 && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md border border-white/28 dark:border-white/[0.06] bg-white/34 dark:bg-white/[0.024] text-muted-foreground">
                  ×{repeat}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
              {title}
            </div>
            {premise && (
              <div className="mt-1 text-[12px] text-muted-foreground break-words">
                {premise}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={onCopy}
              className="h-8 px-2 rounded-lg border border-white/28 dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.024] hover:bg-white/46 dark:hover:bg-white/[0.035] transition-colors inline-flex items-center gap-1.5"
              aria-label={copied ? t('chat:jsonCard.copied', { defaultValue: 'Copied' }) : t('chat:jsonCard.copy', { defaultValue: 'Copy' })}
              title={copied ? t('chat:jsonCard.copied', { defaultValue: 'Copied' }) : t('chat:jsonCard.copy', { defaultValue: 'Copy' })}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
            </button>
          </div>
        </div>

        {screenplaySummary && (
          <div className="mt-3 rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
              <FileText className="h-3.5 w-3.5" />
              <span>Screenplay Summary</span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-muted-foreground font-mono">
              {screenplaySummary}
            </pre>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {screenplayText && (
            <button
              type="button"
              onClick={() => setShowScript((open) => !open)}
              className="w-full rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] px-3 py-2 text-left text-[12px] font-medium text-zinc-800 dark:text-white/78 inline-flex items-center gap-2"
            >
              {showScript ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Full Screenplay
            </button>
          )}
          {showScript && screenplayText && (
            <div className="rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] p-3">
              <CodeViewer code={screenplayText} language="text" />
            </div>
          )}

          {metricEntries.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowMetrics((open) => !open)}
                className="w-full rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] px-3 py-2 text-left text-[12px] font-medium text-zinc-800 dark:text-white/78 inline-flex items-center gap-2"
              >
                {showMetrics ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Story Metrics
              </button>
              {showMetrics && (
                <div className="rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] p-3">
                  <div className="space-y-2">
                    {metricEntries.map(([key, metricValue]) => (
                      <div key={key} className="flex items-start justify-between gap-3 text-[12px]">
                        <div className="text-muted-foreground break-all">{key}</div>
                        <div className="text-zinc-800 dark:text-zinc-100">{String(metricValue)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {visualEntries.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowVisualBible((open) => !open)}
                className="w-full rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] px-3 py-2 text-left text-[12px] font-medium text-zinc-800 dark:text-white/78 inline-flex items-center gap-2"
              >
                {showVisualBible ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Visual Bible
              </button>
              {showVisualBible && (
                <div className="rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] p-3">
                  <div className="space-y-2">
                    {visualEntries.map(([key, visualValue]) => (
                      <div key={key} className="text-[12px] leading-5">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200 break-all">{key}</div>
                        <div className="text-muted-foreground break-words">{String(visualValue)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {bibleElements.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowBibleElements((open) => !open)}
                className="w-full rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] px-3 py-2 text-left text-[12px] font-medium text-zinc-800 dark:text-white/78 inline-flex items-center gap-2"
              >
                {showBibleElements ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Bible Elements ({bibleElements.length})
              </button>
              {showBibleElements && (
                <div className="rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] p-3">
                  <CodeViewer code={JSON.stringify(bibleElements, null, 2)} language="json" />
                </div>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setShowRaw((open) => !open)}
            className="w-full rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] px-3 py-2 text-left text-[12px] font-medium text-zinc-800 dark:text-white/78 inline-flex items-center gap-2"
          >
            {showRaw ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Raw JSON
          </button>
        </div>

        {showRaw && (
          <div className="mt-3">
            <CodeViewer code={raw} language="json" />
          </div>
        )}
      </div>
    </div>
  )
}
