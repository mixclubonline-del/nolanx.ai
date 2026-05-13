import { Message, PendingType, ToolCall } from '@/lib/nolanx/types/types'
import { eventBus, TEvents } from '@/lib/nolanx/utils/event'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, FileText, Loader2, Eye, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

type PlannerStatusPanelProps = {
  messages: Message[]
  pending: PendingType
  sessionId?: string
}

type PlanStep = {
  title: string
  description?: string
}

type StepStatus = 'completed' | 'in_progress' | 'pending'
type StepKind = 'script' | 'world' | 'video' | 'audio' | 'final' | 'world_video' | 'generic'
type PlannerTranslate = (key: string, values?: Record<string, string | number>) => string

type ToolMaps = {
  completedCounts: Record<string, number>
  startedNames: Set<string>
  completedNames: Set<string>
  pendingNames: Set<string>
  executeStoryboardStarted: boolean
  executeStoryboardDone: boolean
}

type LiveProgressState = {
  audioCount: number
  imageCount: number
  progressKind: StepKind | null
  progressText: string
  reviewItems: Array<{ layer: string; status: string; score?: number; summary: string }>
  scriptCount: number
  videoCount: number
}

const INITIAL_LIVE_PROGRESS: LiveProgressState = {
  audioCount: 0,
  imageCount: 0,
  progressKind: null,
  progressText: '',
  reviewItems: [],
  scriptCount: 0,
  videoCount: 0,
}

function extractJsonObjects(text: string): string[] {
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

function parsePlanArgs(raw: string): { steps?: PlanStep[] } | null {
  try {
    return JSON.parse(raw)
  } catch {
    const candidates = extractJsonObjects(raw)
    for (let i = candidates.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(candidates[i])
      } catch {
        continue
      }
    }
  }

  return null
}

function normalizePlanText(text: string) {
  return text.replace(/^\s*(\d+[\.\u3001、\s]*)+/, '').trim()
}

function inferStepKind(title: string, index: number): StepKind {
  const normalized = normalizePlanText(title).toLowerCase()

  if (
    normalized.includes('分镜') ||
    normalized.includes('脚本') ||
    normalized.includes('storyboard') ||
    normalized.includes('script') ||
    index === 0
  ) {
    return 'script'
  }

  const mentionsWorld =
    normalized.includes('世界观') ||
    normalized.includes('视觉资产') ||
    normalized.includes('角色') ||
    normalized.includes('场景') ||
    normalized.includes('道具') ||
    normalized.includes('world') ||
    normalized.includes('asset')

  const mentionsVideo =
    normalized.includes('视频') ||
    normalized.includes('video')

  if (mentionsWorld && mentionsVideo) {
    return 'world_video'
  }

  if (mentionsWorld) {
    return 'world'
  }

  if (mentionsVideo) {
    return 'video'
  }

  if (
    normalized.includes('配音') ||
    normalized.includes('音色') ||
    normalized.includes('人声') ||
    normalized.includes('音频') ||
    normalized.includes('旁白') ||
    normalized.includes('tts') ||
    normalized.includes('audio') ||
    normalized.includes('voice')
  ) {
    return 'audio'
  }

  if (
    normalized.includes('合成') ||
    normalized.includes('最终') ||
    normalized.includes('compose') ||
    normalized.includes('assembly')
  ) {
    return 'final'
  }

  return 'generic'
}

function inferProgressKind(text: string): StepKind | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  if (
    normalized.includes('storyboard') ||
    normalized.includes('script track') ||
    normalized.includes('structured output') ||
    normalized.includes('script')
  ) {
    return 'script'
  }

  if (
    normalized.includes('world track') ||
    normalized.includes('world asset') ||
    normalized.includes('reference image') ||
    normalized.includes('image')
  ) {
    return 'world'
  }

  if (
    normalized.includes('video') ||
    normalized.includes('kling')
  ) {
    return 'video'
  }

  if (
    normalized.includes('voice') ||
    normalized.includes('audio') ||
    normalized.includes('music') ||
    normalized.includes('tts')
  ) {
    return 'audio'
  }

  if (
    normalized.includes('final') ||
    normalized.includes('complete') ||
    normalized.includes('planner')
  ) {
    return 'final'
  }

  return null
}

function getLatestPlan(messages: Message[]): PlanStep[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      continue
    }

    const writePlanTool = message.tool_calls.find(
      (toolCall) => toolCall.function.name === 'write_plan'
    )

    if (!writePlanTool) {
      continue
    }

    const parsed = parsePlanArgs(writePlanTool.function.arguments || '')
    const parsedSteps = parsed?.steps
    if (Array.isArray(parsedSteps) && parsedSteps.length > 0) {
      return parsedSteps
    }
  }

  return []
}

function buildToolMaps(messages: Message[]): ToolMaps {
  const toolCallNameById = new Map<string, string>()
  const openToolCallIds = new Set<string>()
  const startedNames = new Set<string>()
  const completedNames = new Set<string>()
  const pendingNames = new Set<string>()
  const completedCounts: Record<string, number> = {}

  messages.forEach((message) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      message.tool_calls.forEach((toolCall: ToolCall) => {
        toolCallNameById.set(toolCall.id, toolCall.function.name)
        openToolCallIds.add(toolCall.id)
        startedNames.add(toolCall.function.name)
      })
    }
  })

  messages.forEach((message) => {
    if (message.role !== 'tool') {
      return
    }

    const toolName = toolCallNameById.get(message.tool_call_id)
    if (!toolName) {
      return
    }

    openToolCallIds.delete(message.tool_call_id)
    completedNames.add(toolName)
    completedCounts[toolName] = (completedCounts[toolName] || 0) + 1
  })

  openToolCallIds.forEach((toolCallId) => {
    const toolName = toolCallNameById.get(toolCallId)
    if (toolName) {
      pendingNames.add(toolName)
    }
  })

  let executeStoryboardDone = false
  messages.forEach((message) => {
    if (message.role !== 'tool' || typeof message.content !== 'string') {
      return
    }
    if (message.content.includes('execute_storyboard completed:')) {
      executeStoryboardDone = true
    }
  })

  return {
    completedCounts,
    startedNames,
    completedNames,
    pendingNames,
    executeStoryboardStarted: startedNames.has('execute_storyboard'),
    executeStoryboardDone,
  }
}

function getStepTitle(kind: StepKind, fallbackTitle: string, t: PlannerTranslate) {
  switch (kind) {
    case 'script':
      return t('steps.script')
    case 'world':
      return t('steps.world')
    case 'video':
      return t('steps.video')
    case 'audio':
      return t('steps.audio')
    case 'final':
      return t('steps.final')
    case 'world_video':
      return t('steps.worldVideo')
    default:
      return fallbackTitle
  }
}

export default function PlannerStatusPanel({
  messages,
  pending,
  sessionId,
}: PlannerStatusPanelProps) {
  const t = useTranslations('CanvasChat.planner')
  const [expanded, setExpanded] = useState(false)
  const [liveProgress, setLiveProgress] = useState<LiveProgressState>(INITIAL_LIVE_PROGRESS)
  const plan = useMemo(() => getLatestPlan(messages), [messages])

  useEffect(() => {
    setLiveProgress(INITIAL_LIVE_PROGRESS)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const handleToolCallProgress = (
      data: TEvents['Socket::Session::ToolCallProgress']
    ) => {
      if (data.session_id !== sessionId) {
        return
      }

      const update = (data.update || '').trim()
      if (update === 'Timeline analysis complete.') {
        return
      }

      setLiveProgress((prev) => ({
        ...prev,
        progressKind: inferProgressKind(update) || prev.progressKind,
        progressText: update,
      }))
    }

    const handleScriptGenerated = (
      data: TEvents['Socket::Session::ScriptGenerated']
    ) => {
      if (data.session_id !== sessionId) {
        return
      }

      setLiveProgress((prev) => ({
        ...prev,
        progressKind: 'script',
        scriptCount: prev.scriptCount + 1,
      }))
    }

    const handleImageGenerated = (
      data: TEvents['Socket::Session::ImageGenerated']
    ) => {
      if (data.session_id !== sessionId) {
        return
      }

      setLiveProgress((prev) => ({
        ...prev,
        imageCount: prev.imageCount + 1,
        progressKind: 'world',
      }))
    }

    const handleVideoGenerated = (
      data: TEvents['Socket::Session::VideoGenerated']
    ) => {
      if (data.session_id !== sessionId) {
        return
      }

      setLiveProgress((prev) => ({
        ...prev,
        videoCount: prev.videoCount + 1,
        progressKind: 'video',
      }))
    }

    const handleAudioGenerated = (
      data: TEvents['Socket::Session::AudioGenerated']
    ) => {
      if (data.session_id !== sessionId) {
        return
      }

      setLiveProgress((prev) => ({
        ...prev,
        audioCount: prev.audioCount + 1,
        progressKind: 'audio',
      }))
    }

    const handleReview = (
      data: TEvents['Socket::Session::Review']
    ) => {
      if (data.session_id !== sessionId) {
        return
      }

      setLiveProgress((prev) => ({
        ...prev,
        reviewItems: [
          {
            layer: data.layer,
            status: data.status,
            score: data.score,
            summary: data.summary,
          },
          ...prev.reviewItems,
        ].slice(0, 5),
      }))
    }

    eventBus.on('Socket::Session::ToolCallProgress', handleToolCallProgress)
    eventBus.on('Socket::Session::ScriptGenerated', handleScriptGenerated)
    eventBus.on('Socket::Session::ImageGenerated', handleImageGenerated)
    eventBus.on('Socket::Session::VideoGenerated', handleVideoGenerated)
    eventBus.on('Socket::Session::AudioGenerated', handleAudioGenerated)
    eventBus.on('Socket::Session::Review', handleReview)

    return () => {
      eventBus.off('Socket::Session::ToolCallProgress', handleToolCallProgress)
      eventBus.off('Socket::Session::ScriptGenerated', handleScriptGenerated)
      eventBus.off('Socket::Session::ImageGenerated', handleImageGenerated)
      eventBus.off('Socket::Session::VideoGenerated', handleVideoGenerated)
      eventBus.off('Socket::Session::AudioGenerated', handleAudioGenerated)
      eventBus.off('Socket::Session::Review', handleReview)
    }
  }, [sessionId])

  const steps = useMemo(() => {
    if (!plan.length) {
      return []
    }

    const toolMaps = buildToolMaps(messages)
    const imageCompleted =
      (toolMaps.completedCounts.generate_image || 0) +
      (toolMaps.completedCounts.edit_image || 0) +
      liveProgress.imageCount
    const videoCompleted =
      (toolMaps.completedCounts.generate_video || 0) +
      (toolMaps.completedCounts.generate_video_first_last_frame || 0) +
      liveProgress.videoCount
    const audioCompleted =
      (toolMaps.completedCounts.generate_audio || 0) +
      (toolMaps.completedCounts.generate_tts_audio || 0) +
      (toolMaps.completedCounts.generate_music || 0) +
      liveProgress.audioCount
    const scriptCompleted =
      (toolMaps.completedCounts.generate_structured_output || 0) +
      liveProgress.scriptCount

    const worldStarted =
      imageCompleted > 0 ||
      toolMaps.pendingNames.has('generate_image') ||
      toolMaps.pendingNames.has('edit_image')

    const videoStarted =
      videoCompleted > 0 ||
      toolMaps.pendingNames.has('generate_video') ||
      toolMaps.pendingNames.has('generate_video_first_last_frame')

    const audioStarted =
      audioCompleted > 0 ||
      toolMaps.pendingNames.has('generate_audio') ||
      toolMaps.pendingNames.has('generate_tts_audio') ||
      toolMaps.pendingNames.has('generate_music')

    const activeKind = liveProgress.progressKind

    const rawSteps = plan.map((step, index) => {
      const kind = inferStepKind(step.title, index)
      const cleanTitle = normalizePlanText(step.title)
      const localizedTitle = getStepTitle(kind, cleanTitle, t)

      let done = false
      let started = false

      switch (kind) {
        case 'script':
          done = scriptCompleted > 0
          started =
            done ||
            toolMaps.startedNames.has('transfer_to_script_writer') ||
            toolMaps.startedNames.has('generate_structured_output') ||
            activeKind === 'script'
          break
        case 'world':
          done = imageCompleted > 0 || toolMaps.executeStoryboardDone
          started =
            done ||
            worldStarted ||
            toolMaps.executeStoryboardStarted ||
            activeKind === 'world'
          break
        case 'video':
          done = toolMaps.executeStoryboardDone
          started =
            done ||
            videoStarted ||
            activeKind === 'video' ||
            (toolMaps.executeStoryboardStarted && imageCompleted > 0)
          break
        case 'audio':
          done = audioCompleted > 0 || toolMaps.executeStoryboardDone
          started =
            done ||
            audioStarted ||
            activeKind === 'audio'
          break
        case 'final':
          done = toolMaps.executeStoryboardDone
          started =
            done ||
            toolMaps.executeStoryboardStarted ||
            videoStarted ||
            audioStarted ||
            activeKind === 'final'
          break
        case 'world_video':
          done = toolMaps.executeStoryboardDone
          started =
            done ||
            toolMaps.executeStoryboardStarted ||
            worldStarted ||
            videoStarted ||
            activeKind === 'world' ||
            activeKind === 'video'
          break
        default:
          done = toolMaps.executeStoryboardDone
          started = done || toolMaps.executeStoryboardStarted || pending !== false
          break
      }

      return {
        ...step,
        cleanTitle,
        displayTitle: localizedTitle,
        done,
        kind,
        started,
      }
    })

    let currentAssigned = false
    return rawSteps.map((step, index) => {
      const previousComplete = rawSteps.slice(0, index).every((item) => item.done)
      let status: StepStatus = 'pending'

      if (step.done && previousComplete) {
        status = 'completed'
      } else if (
        !currentAssigned &&
        previousComplete &&
        (step.started || pending !== false || index === 0)
      ) {
        status = 'in_progress'
        currentAssigned = true
      }

      return {
        ...step,
        status,
      }
    })
  }, [liveProgress, messages, pending, plan, t])

  if (!steps.length) {
    return null
  }

  const completedCount = steps.filter((step) => step.status === 'completed').length
  const activeStep =
    steps.find((step) => step.status === 'in_progress') ||
    steps.find((step) => step.status === 'pending') ||
    steps[steps.length - 1]
  const headerDetail = activeStep?.displayTitle || ''

  return (
    <div className="mb-2 overflow-hidden rounded-[1.6rem] border border-white/34 bg-white/26 shadow-[0_18px_52px_rgba(0,0,0,0.09)] backdrop-blur-[24px] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.36),rgba(12,12,11,0.26))] dark:shadow-[0_22px_60px_rgba(0,0,0,0.28)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="relative z-10 flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/34 text-neutral-700 shadow-inner backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-white/76">
            <FileText className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold leading-none text-neutral-800 dark:text-white/92">
              {t('title')}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-neutral-600/72 dark:text-white/50">
              <span className="shrink-0">
                {t('completed', { completed: completedCount, total: steps.length })}
              </span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-neutral-600/24 dark:bg-white/18" />
              <span className="truncate">{headerDetail}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {steps.map((step, index) => (
            <div
              key={`${step.displayTitle}-${index}-mini`}
              className={`h-1.5 rounded-full transition-all ${
                step.status === 'completed'
                  ? 'w-4 bg-emerald-500'
                : step.status === 'in_progress'
                    ? 'w-5 bg-neutral-700 dark:bg-white/72'
                    : 'w-2.5 bg-neutral-600/16 dark:bg-white/[0.028]'
              }`}
            />
          ))}
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-neutral-600/55 dark:text-white/48" />
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-600/55 dark:text-white/48" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/28 dark:border-white/[0.06]">
          <div className="max-h-[min(40vh,24rem)] overflow-y-auto px-2.5 py-2">
            {liveProgress.reviewItems.length ? (
              <div className="mb-2 space-y-1.5 rounded-[1rem] border border-white/28 bg-white/18 p-2 dark:border-white/[0.07] dark:bg-white/[0.024]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-600/55 dark:text-white/44">
                  Review Feed
                </div>
                {liveProgress.reviewItems.map((item, index) => (
                  <div key={`${item.layer}-${index}`} className="flex items-start gap-2 text-[11px] text-neutral-700 dark:text-white/74">
                    <div className="mt-0.5 shrink-0">
                      {item.status === 'approved_auto' ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      ) : item.status === 'attention_needed' ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 text-neutral-500 dark:text-white/58" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600/48 dark:text-white/40">
                        {item.layer} {typeof item.score === 'number' ? `· ${item.score}` : ''}
                      </div>
                      <div>{item.summary}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {steps.map((step, index) => (
                <div
                  key={`${step.displayTitle}-${index}`}
                  className="flex items-start gap-2 rounded-[1rem] border border-white/28 bg-white/18 px-2 py-1.5 dark:border-white/[0.07] dark:bg-white/[0.024]"
                >
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : step.status === 'in_progress' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-700 dark:text-white/74" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-black/25 dark:text-white/28" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium tabular-nums text-black/35 dark:text-white/38">
                        {index + 1}.
                      </span>
                      <span className="text-[11px] font-medium leading-4 text-neutral-800 dark:text-white/92">
                        {step.displayTitle}
                      </span>
                    </div>
                    {step.description && (
                      <p className="mt-0.5 text-[10px] leading-4 text-neutral-600/70 dark:text-white/56">
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-0 mt-2 flex justify-end bg-transparent pt-3">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-full border border-white/35 bg-white/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-600 shadow-[0_8px_20px_rgba(0,0,0,0.06)] backdrop-blur-sm transition hover:border-black/12 hover:text-neutral-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-white/66 dark:hover:bg-white/[0.06] dark:hover:text-white"
              >
                Collapse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
