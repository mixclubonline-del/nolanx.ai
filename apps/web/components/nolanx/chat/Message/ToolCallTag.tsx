import { TOOL_CALL_NAME_MAPPING } from '@/lib/nolanx/constants'
import { ToolCall } from '@/lib/nolanx/types/types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import MultiChoicePrompt from '../MultiChoicePrompt'
import SingleChoicePrompt from '../SingleChoicePrompt'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import CodeViewer from '../CodeViewer'
import JsonCard from '../JsonCard'

type ToolCallTagProps = {
  toolCall: ToolCall
  isExpanded: boolean
  onToggleExpand: () => void
}

function tryParseJson(raw: string) {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return null
  }

  const candidates = [trimmed]
  const jsonStart = Math.min(
    ...['{', '[']
      .map((token) => trimmed.indexOf(token))
      .filter((index) => index >= 0),
  )

  if (Number.isFinite(jsonStart) && jsonStart > 0) {
    candidates.push(trimmed.slice(jsonStart))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }

  return null
}

const ToolCallTag: React.FC<ToolCallTagProps> = ({
  toolCall,
  isExpanded,
  onToggleExpand,
}) => {
  const { t } = useTranslation()
  const { name, arguments: inputs } = toolCall.function

  if (name == 'prompt_user_multi_choice') {
    return <MultiChoicePrompt />
  }
  if (name == 'prompt_user_single_choice') {
    return <SingleChoicePrompt />
  }
  if (name == 'write_plan') {
    return null
  }
  if (name.startsWith('transfer_to')) {
    return null
  }
  const parsedArgs = tryParseJson(inputs)

  return (
    <div className="mb-3 w-full max-w-full min-w-0 overflow-hidden rounded-[1.6rem] border border-white/34 bg-white/24 shadow-[0_14px_40px_rgba(0,0,0,0.08)] backdrop-blur-[20px] transition-all duration-300 hover:shadow-[0_20px_50px_rgba(0,0,0,0.12)] dark:border-white/[0.06] dark:bg-transparent dark:shadow-[0_20px_56px_rgba(0,0,0,0.24)]">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-3 transition-colors duration-200 hover:bg-white/14 dark:hover:bg-white/[0.045] md:p-4"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-2 md:gap-3">
          <div className="rounded-xl border border-white/40 bg-white/34 p-1.5 text-neutral-700 backdrop-blur-sm dark:border-white/[0.06] dark:bg-transparent dark:text-white/78 md:p-2">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path clipRule="evenodd" fillRule="evenodd" d="M20.599 1.5c-.376 0-.743.111-1.055.32l-5.08 3.385a18.747 18.747 0 0 0-3.471 2.987 10.04 10.04 0 0 1 4.815 4.815 18.748 18.748 0 0 0 2.987-3.472l3.386-5.079A1.902 1.902 0 0 0 20.599 1.5Zm-8.3 14.025a18.76 18.76 0 0 0 1.896-1.207 8.026 8.026 0 0 0-4.513-4.513A18.75 18.75 0 0 0 8.475 11.7l-.278.5a5.26 5.26 0 0 1 3.601 3.602l.502-.278ZM6.75 13.5A3.75 3.75 0 0 0 3 17.25a1.5 1.5 0 0 1-1.601 1.497.75.75 0 0 0-.7 1.123 5.25 5.25 0 0 0 9.8-2.62 3.75 3.75 0 0 0-3.75-3.75Z"></path>
            </svg>
          </div>

          <p className="text-sm font-semibold text-neutral-800 dark:text-white/92">
            {t(`chat:toolCallNames.${name}`, { defaultValue: TOOL_CALL_NAME_MAPPING[name] ?? name })}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {parsedArgs && Object.keys(parsedArgs).length > 0 && (
            <div className="rounded-full border border-white/32 bg-white/28 px-2 py-1 text-xs font-medium text-neutral-600 dark:border-white/[0.06] dark:bg-transparent dark:text-white/58">
              {Object.keys(parsedArgs).length}
            </div>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-neutral-500 transition-transform duration-200 dark:text-white/52" />
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-500 transition-transform duration-200 dark:text-white/52" />
          )}
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="border-t border-white/28 dark:border-white/[0.06]">
          <div className="p-2 md:p-3">
            {parsedArgs && Object.keys(parsedArgs).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(parsedArgs).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-[1rem] border border-white/28 bg-white/20 p-2 transition-all duration-200 hover:bg-white/30 dark:border-white/[0.06] dark:bg-transparent dark:hover:bg-white/[0.02] md:p-3"
                  >
                    <div className="flex flex-col gap-1 md:gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-white/48">{key}:</span>
                      {typeof value == 'object'
                        ? (
                          <JsonCard
                            value={value}
                            raw={JSON.stringify(value, null, 2)}
                            defaultExpandedDepth={1}
                          />
                        )
                        : (
                          <div className="min-w-0 max-w-full overflow-hidden whitespace-pre-wrap rounded-xl bg-white/36 p-2 text-xs leading-relaxed text-neutral-800 break-words dark:bg-transparent dark:text-white/80 md:text-sm">
                            {String(value)}
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[1rem] border border-white/28 bg-white/20 p-2 transition-all duration-200 hover:bg-white/30 dark:border-white/[0.06] dark:bg-transparent dark:hover:bg-white/[0.02] md:p-3">
                {parsedArgs && typeof parsedArgs === 'object' ? (
                  <JsonCard
                    value={parsedArgs}
                    raw={JSON.stringify(parsedArgs, null, 2)}
                    defaultExpandedDepth={1}
                  />
                ) : (
                  <CodeViewer code={inputs} language="json" />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ToolCallTag
