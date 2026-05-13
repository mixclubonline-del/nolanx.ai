import React, { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, CheckCircle2 } from 'lucide-react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'

export default function WritePlanToolCall({ args }: { args: string }) {
  const [isExpanded, setIsExpanded] = useState(true)
  const { t } = useTranslation()

  let parsedArgs: {
    steps: {
      title: string
      description: string
    }[]
  } | null = null

  const extractJsonObjects = (text: string): string[] => {
    const objects: string[] = []
    let depth = 0
    let startIndex = -1
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') {
        if (depth === 0) startIndex = i
        depth++
      } else if (ch === '}') {
        if (depth > 0) depth--
        if (depth === 0 && startIndex !== -1) {
          objects.push(text.slice(startIndex, i + 1))
          startIndex = -1
        }
      }
    }
    return objects
  }

  try {
    parsedArgs = JSON.parse(args)
  } catch (error) {
    const candidates = extractJsonObjects(args)
    for (let i = candidates.length - 1; i >= 0; i--) {
      try {
        parsedArgs = JSON.parse(candidates[i])
        break
      } catch (e) {}
    }
  }

  const steps = Array.isArray(parsedArgs?.steps) ? parsedArgs!.steps : []

  return (
    <div className="mb-6 w-full max-w-full min-w-0 overflow-hidden rounded-[1.2rem] border border-white/24 bg-white/26 shadow-[0_16px_42px_rgba(0,0,0,0.08)] backdrop-blur-[22px] transition-all duration-300 hover:bg-white/34 hover:shadow-[0_22px_52px_rgba(0,0,0,0.12)] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.24),rgba(12,12,11,0.16))]">
      <div
        className="flex items-center justify-between p-4 transition-colors duration-200 hover:bg-white/20 dark:hover:bg-white/[0.02]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-white/24 bg-white/34 p-2 dark:border-white/[0.06] dark:bg-white/[0.024]">
            <FileText className="h-4 w-4 text-neutral-600 dark:text-white/48" />
          </div>

          <p className="text-sm font-semibold text-neutral-800 dark:text-white/88">
            {t('chat:plan.title')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {steps.length > 0 && (
            <div className="rounded-md border border-white/24 bg-white/30 px-2 py-1 text-xs font-medium text-neutral-600 dark:border-white/[0.06] dark:bg-white/[0.024] dark:text-white/48">
              {steps.length}
            </div>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-neutral-500 transition-transform duration-200 dark:text-white/46" />
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-500 transition-transform duration-200 dark:text-white/46" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-white/24 dark:border-white/[0.06]">
          <div className="p-3 space-y-2">
            {steps.map((step, index) => (
              <div
                key={`${step.title}-${index}`}
                className="rounded-lg border border-white/24 bg-white/24 p-3 transition-all duration-200 hover:bg-white/34 dark:border-white/[0.06] dark:bg-white/[0.018] dark:hover:bg-white/[0.024]"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex-shrink-0 rounded-full border border-white/24 bg-white/30 p-0.5 dark:border-white/[0.06] dark:bg-white/[0.024]">
                    <CheckCircle2 className="h-3 w-3 text-neutral-600 dark:text-white/48" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-white/86">
                      {index + 1}. {step.title}
                    </h4>
                    {step.description && (
                      <p className="text-sm leading-relaxed text-neutral-600 dark:text-white/52">
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
