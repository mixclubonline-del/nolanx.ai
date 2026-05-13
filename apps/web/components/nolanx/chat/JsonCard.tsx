"use client"

import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Code2 } from 'lucide-react'
import { cn } from '@/lib/nolanx/utils/utils'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import CodeViewer from './CodeViewer'
import ScriptCard, { isScriptPayload } from './ScriptCard'

type JsonCardProps = {
  value: unknown
  raw: string
  repeat?: number
  className?: string
  defaultExpandedDepth?: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatSummary(value: unknown): string {
  if (Array.isArray(value)) return `Array · ${value.length} items`
  if (isPlainObject(value)) return `Object · ${Object.keys(value).length} keys`
  return typeof value
}

function JsonValuePill({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-[12px] text-muted-foreground">null</span>
  }
  const t = typeof value
  if (t === 'string') {
    return <span className="text-[12px] text-emerald-700 dark:text-emerald-300 break-all">"{String(value)}"</span>
  }
  if (t === 'number') {
    return <span className="text-[12px] text-sky-700 dark:text-sky-300">{String(value)}</span>
  }
  if (t === 'boolean') {
    return <span className="text-[12px] text-amber-700 dark:text-amber-300">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    return (
      <span className="text-[12px] text-muted-foreground">
        [{value.length}]
      </span>
    )
  }
  if (isPlainObject(value)) {
    return (
      <span className="text-[12px] text-muted-foreground">
        {'{'}
        {Object.keys(value).length}
        {'}'}
      </span>
    )
  }
  return <span className="text-[12px] text-muted-foreground">{String(value)}</span>
}

function JsonTreeNode({
  name,
  value,
  depth,
  defaultExpandedDepth,
}: {
  name?: string
  value: unknown
  depth: number
  defaultExpandedDepth: number
}) {
  const isContainer = Array.isArray(value) || isPlainObject(value)
  const [open, setOpen] = useState(depth < defaultExpandedDepth)

  const label = name ?? (Array.isArray(value) ? 'root[]' : 'root{}')

  if (!isContainer) {
    return (
      <div className="flex flex-col gap-1 py-1 min-w-0 md:flex-row md:items-start md:justify-between md:gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200 break-all">{label}</span>
        </div>
        <div className="min-w-0 md:max-w-[55%] text-right">
          <JsonValuePill value={value} />
        </div>
      </div>
    )
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, idx) => [String(idx), v])
    : Object.entries(value)

  const MAX_CHILDREN = 80
  const shown = entries.slice(0, MAX_CHILDREN)
  const remaining = entries.length - shown.length

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex flex-col gap-1 py-1 rounded-md transition-colors md:flex-row md:items-start md:justify-between md:gap-3',
          'hover:bg-white/30 dark:hover:bg-white/[0.024]'
        )}
        aria-expanded={open}
      >
        <span className="min-w-0 flex items-start gap-1.5">
          <span className="mt-0.5 text-muted-foreground flex-shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0">
            <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200 break-all">{label}</span>
          </span>
        </span>
        <span className="min-w-0 md:max-w-[55%] text-right pl-5 md:pl-0">
          <JsonValuePill value={value} />
        </span>
      </button>

      {open && (
        <div className="pl-4 mt-1 border-l border-black/5 dark:border-white/[0.06]">
          {shown.map(([k, v]) => (
            <JsonTreeNode
              key={`${depth}-${label}-${k}`}
              name={k}
              value={v}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
          {remaining > 0 && (
            <div className="py-1 text-[12px] text-muted-foreground">
              + {remaining} more…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function JsonCard({
  value,
  raw,
  repeat = 1,
  className,
  defaultExpandedDepth = 1,
}: JsonCardProps) {
  if (isScriptPayload(value)) {
    return (
      <ScriptCard
        value={value}
        raw={raw}
        repeat={repeat}
        className={className}
      />
    )
  }

  const { t } = useTranslation()
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)

  const pretty = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return raw
    }
  }, [raw, value])

  const summary = useMemo(() => formatSummary(value), [value])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(pretty)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <div
      className={cn(
        'not-prose w-full max-w-full min-w-0 overflow-hidden rounded-[1.2rem] border border-white/28 bg-white/30 dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.24),rgba(12,12,11,0.16))]',
        className
      )}
    >
      <div className="h-0.5 bg-[linear-gradient(90deg,rgb(255,90,0),rgb(255,154,31))]" />

      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">JSON</span>
              {repeat > 1 && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md border border-white/28 dark:border-white/[0.06] bg-white/34 dark:bg-white/[0.024] text-muted-foreground">
                  ×{repeat}
                </span>
              )}
            </div>
            <div className="text-[12px] text-muted-foreground mt-0.5">{summary}</div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={onCopy}
              className="h-8 px-2 rounded-lg border border-white/28 dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.024] hover:bg-white/46 dark:hover:bg-white/[0.035] transition-colors inline-flex items-center gap-1.5"
              aria-label={copied ? t('chat:jsonCard.copied', { defaultValue: 'Copied' }) : t('chat:jsonCard.copy', { defaultValue: 'Copy' })}
              title={copied ? t('chat:jsonCard.copied', { defaultValue: 'Copied' }) : t('chat:jsonCard.copy', { defaultValue: 'Copy' })}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-600" />
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-muted-foreground" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              className="h-8 px-2 rounded-lg border border-white/28 dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.024] hover:bg-white/46 dark:hover:bg-white/[0.035] transition-colors inline-flex items-center gap-1.5"
              aria-label={showCode ? t('chat:jsonCard.hideCode', { defaultValue: 'Hide code' }) : t('chat:jsonCard.showCode', { defaultValue: 'Show code' })}
              title={showCode ? t('chat:jsonCard.hideCode', { defaultValue: 'Hide code' }) : t('chat:jsonCard.showCode', { defaultValue: 'Show code' })}
            >
              <Code2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-white/24 dark:border-white/[0.06] bg-white/24 dark:bg-white/[0.018] p-2">
          <JsonTreeNode value={value} depth={0} defaultExpandedDepth={defaultExpandedDepth} />
        </div>

        {showCode && (
          <div className="mt-3">
            <CodeViewer code={pretty} language="json" />
          </div>
        )}
      </div>
    </div>
  )
}
