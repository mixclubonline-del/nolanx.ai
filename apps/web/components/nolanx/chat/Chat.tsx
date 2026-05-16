"use client"

import { getChatSession, sendMessages, createChatSession, forkSession } from '@/lib/nolanx/api/chat'
import { getSharedChatHistory } from '@/lib/nolanx/api/canvas'
import Blur from '@/components/nolanx/common/Blur'
import { ScrollArea } from '../ui/scroll-area'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { eventBus, TEvents } from '@/lib/nolanx/utils/event'
import {
  AssistantMessage,
  Message,
  Model,
  PendingType,
  Session,
} from '@/lib/nolanx/types/types'
import { produce } from 'immer'
import { motion } from 'motion/react'
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { useSearchParams } from 'next/navigation'
import { PhotoProvider } from 'react-photo-view'
import { useLocale } from 'next-intl'
import { localizePathname } from '@/i18n/pathname'
import ShinyText from '../ui/shiny-text'
import ChatTextarea from './ChatTextarea'
import MessageRegular from './Message/Regular'
import ToolCallContent from './Message/ToolCallContent'
import ToolCallTag from './Message/ToolCallTag'
import SessionSelector from './SessionSelector'
import PlannerStatusPanel from './PlannerStatusPanel'
import ToolcallProgressUpdate from './ToolcallProgressUpdate'
import VideoGenerationGateDialog from './VideoGenerationGateDialog'

import { useConfigs } from '@/lib/nolanx/contexts/configs'
import { Button } from '../ui/button'
import { Play, SkipForward, RotateCcw, MessageSquare } from 'lucide-react'
import 'react-photo-view/dist/react-photo-view.css'
import '@/styles/nolanx/canvas-chat.css'

const LEGACY_HIDE_MESSAGE_TEXTS = new Set(['Timeline analysis complete.'])

function shouldHideMessage(message: Message): boolean {
  if (message.role !== 'assistant') return false

  const content = message.content
  if (typeof content === 'string') {
    return LEGACY_HIDE_MESSAGE_TEXTS.has(content.trim())
  }

  if (Array.isArray(content) && content.length === 1 && content[0]?.type === 'text') {
    return LEGACY_HIDE_MESSAGE_TEXTS.has((content[0].text || '').trim())
  }

  return false
}

function filterMessages(messages: Message[]): Message[] {
  return messages.filter((m) => !shouldHideMessage(m))
}

type ChatInterfaceProps = {
  canvasId: string
  sessionList: Session[]
  setSessionList: Dispatch<SetStateAction<Session[]>>
  isShared?: boolean
  onSessionChange?: (session: Session | null) => void
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  canvasId,
  sessionList,
  setSessionList,
  isShared = false,
  onSessionChange,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const appLocale = locale === 'zh-CN' ? 'zh-CN' : 'en'
  const preferredLanguage = locale || 'en'
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const { initCanvas, setInitCanvas } = useConfigs()
  const [isForking, setIsForking] = useState(false) // 控制是否显示聊天输入框(shared模式)
  const [queuedUserMessages, setQueuedUserMessages] = useState<Message[]>([])
  const queuedMessageInFlightRef = useRef(false)
  const queuePausedRef = useRef(false)

  const searchParams = useSearchParams()
  const searchSessionId = searchParams?.get('sessionId') || ''
  const selectedSessionStorageKey = `nolanx:canvas:${canvasId}:sessionId`

  const buildCanvasUrl = useCallback(
    (nextCanvasId: string, nextSessionId?: string | null) => {
      const base = localizePathname(`/canvas/${nextCanvasId}`, appLocale)
      return nextSessionId ? `${base}?sessionId=${nextSessionId}` : base
    },
    [appLocale]
  )

  useEffect(() => {
    setSession((prev) => {
      if (sessionList.length === 0) {
        return null
      }

      if (searchSessionId) {
        const urlSession = sessionList.find((s) => s.id === searchSessionId) || null
        if (urlSession) {
          return urlSession
        }
        return prev && sessionList.some((s) => s.id === prev.id) ? prev : null
      }

      if (prev && sessionList.some((s) => s.id === prev.id)) {
        return prev
      }

      if (typeof window !== 'undefined') {
        try {
          const storedSessionId = window.localStorage.getItem(selectedSessionStorageKey)
          const storedSession = storedSessionId
            ? sessionList.find((s) => s.id === storedSessionId) || null
            : null
          if (storedSession) {
            return storedSession
          }
        } catch (error) {
          console.warn('Failed to read selected session cache:', error)
        }
      }

      return sessionList[0]
    })
  }, [sessionList, searchSessionId, selectedSessionStorageKey])

  useEffect(() => {
    if (!session?.id || typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(selectedSessionStorageKey, session.id)
    } catch (error) {
      console.warn('Failed to persist selected session cache:', error)
    }
  }, [session?.id, selectedSessionStorageKey])

  // Notify parent component when session changes
  useEffect(() => {
    onSessionChange?.(session)
  }, [session, onSessionChange])

  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState<PendingType>(
    initCanvas ? 'text' : false
  )

  // 重放相关状态
  const [isReplaying, setIsReplaying] = useState(false)
  const [replayMessages, setReplayMessages] = useState<Message[]>([])
  const [currentReplayIndex, setCurrentReplayIndex] = useState(0)
  const [replayIntervalRef, setReplayIntervalRef] = useState<NodeJS.Timeout | null>(null)
  const [replayCompleted, setReplayCompleted] = useState(false)

  const sessionId = session?.id

  const sessionIdRef = useRef<string>(session?.id || '')
  const [expandingToolCalls, setExpandingToolCalls] = useState<string[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(false)

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !isAtBottomRef.current) {
      return
    }
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current!.scrollHeight,
        behavior: 'smooth',
      })
    }, 200)
  }, [])

  // 重放功能
  const startReplay = useCallback((replayMsgs: Message[]) => {
    if (!isShared || replayMsgs.length === 0) return

    // 清理之前的定时器
    if (replayIntervalRef) {
      clearInterval(replayIntervalRef)
    }

    // 重置状态
    setMessages([])
    setCurrentReplayIndex(0)
    setIsReplaying(true)
    setReplayCompleted(false)

    let index = 0
    const replayInterval = setInterval(() => {
      if (index < replayMsgs.length) {
        setMessages(prev => [...prev, replayMsgs[index]])
        setCurrentReplayIndex(index + 1)
        index++
        scrollToBottom(true)
      } else {
        setIsReplaying(false)
        setReplayCompleted(true)
        clearInterval(replayInterval)
        setReplayIntervalRef(null)
      }
    }, 1500) // 每1.5秒显示一条消息，比正常对话更快

    setReplayIntervalRef(replayInterval)
  }, [isShared, scrollToBottom, replayIntervalRef])

  // 快进到最终结果
  const skipToEnd = useCallback(() => {
    if (!isShared || replayMessages.length === 0) return

    // 清理定时器
    if (replayIntervalRef) {
      clearInterval(replayIntervalRef)
      setReplayIntervalRef(null)
    }

    // 显示所有消息
    setMessages(replayMessages)
    setCurrentReplayIndex(replayMessages.length)
    setIsReplaying(false)
    setReplayCompleted(true)
    scrollToBottom(true)
  }, [isShared, replayMessages, replayIntervalRef, scrollToBottom])

  // 重新播放
  const replayAgain = useCallback(() => {
    if (!isShared || replayMessages.length === 0) return
    startReplay(replayMessages)
  }, [isShared, replayMessages, startReplay])

  const handleDelta = useCallback(
    (data: TEvents['Socket::Session::Delta']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setPending('text')
      setMessages(
        produce((prev) => {
          const last = prev.at(-1)
          if (
            last?.role === 'assistant' &&
            last.content != null &&
            last.tool_calls == null
          ) {
            if (typeof last.content === 'string') {
              last.content += data.text
            } else if (
              last.content &&
              last.content.at(-1) &&
              last.content.at(-1)!.type === 'text'
            ) {
              ; (last.content.at(-1) as { text: string }).text += data.text
            }
          } else {
            prev.push({
              role: 'assistant',
              content: data.text,
            })
          }
        })
      )
      scrollToBottom()
    },
    [sessionId, scrollToBottom]
  )

  const handleToolCall = useCallback(
    (data: TEvents['Socket::Session::ToolCall']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setMessages(
        produce((prev) => {
          const existToolCall = prev.find(
            (m) =>
              m.role === 'assistant' &&
              m.tool_calls &&
              m.tool_calls.find((t) => t.id == data.id)
          )
          if (existToolCall) {
            return
          }

          console.log('👇tool_call event get', data)

          // 根据工具调用类型设置不同的pending状态
          switch (data.name) {
            case 'generate_image':
            case 'edit_image':
              setPending('image')
              break
            case 'generate_video':
            case 'generate_video_first_last_frame':
              setPending('video')
              break
            case 'generate_audio':
            case 'generate_tts_audio':
            case 'generate_music':
              setPending('audio')
              break
            default:
              setPending('tool')
              break
          }

          prev.push({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: data.name,
                  arguments: '',
                },
                id: data.id,
              },
            ],
          })
        })
      )

    },
    [sessionId]
  )

  const handleToolCallArguments = useCallback(
    (data: TEvents['Socket::Session::ToolCallArguments']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setMessages(
        produce((prev) => {
          const lastMessage = prev.find(
            (m) =>
              m.role === 'assistant' &&
              m.tool_calls &&
              m.tool_calls.find((t) => t.id == data.id)
          ) as AssistantMessage

          if (lastMessage) {
            const toolCall = lastMessage.tool_calls!.find(
              (t) => t.id == data.id
            )
            if (toolCall) {
              toolCall.function.arguments += data.text

              // 根据工具调用类型设置不同的pending状态
              switch (toolCall.function.name) {
                case 'generate_image':
                case 'edit_image':
                  setPending('image')
                  break
                case 'generate_video':
                case 'generate_video_first_last_frame':
                  setPending('video')
                  break
                case 'generate_audio':
                case 'generate_tts_audio':
                case 'generate_music':
                  setPending('audio')
                  break
                default:
                  setPending('tool')
                  break
              }
            }
          }
        })
      )
      scrollToBottom()
    },
    [sessionId, scrollToBottom]
  )

  const handleToolResult = useCallback(
    (data: TEvents['Socket::Session::ToolResult']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setMessages(
        produce((prev) => {
          const alreadyExists = prev.some(
            (m) => m.role === 'tool' && m.tool_call_id === data.tool_call_id
          )
          if (alreadyExists) return

          prev.push({
            role: 'tool',
            tool_call_id: data.tool_call_id,
            content: data.content,
          })
        })
      )

      scrollToBottom()
    },
    [sessionId, scrollToBottom]
  )

  const handleImageGenerated = useCallback(
    (data: TEvents['Socket::Session::ImageGenerated']) => {
      if (
        data.canvas_id &&
        data.canvas_id !== canvasId &&
        data.session_id !== sessionId
      ) {
        return
      }

      console.log('⭐️dispatching image_generated', data)
      setPending('image')

      // Notify timeline to refresh data
      console.log('📤 Chat emitting Canvas::DataUpdated event for image_generated');
      eventBus.emit('Canvas::DataUpdated', {
        canvasId: canvasId,
        trigger: 'image_generated'
      })
    },
    [canvasId, sessionId]
  )

  const handleVideoGenerated = useCallback(
    (data: TEvents['Socket::Session::VideoGenerated']) => {
      if (
        data.canvas_id &&
        data.canvas_id !== canvasId &&
        data.session_id !== sessionId
      ) {
        return
      }

      console.log('🎬 dispatching video_generated', data)
      setPending('video')

      // Notify timeline to refresh data
      console.log('📤 Chat emitting Canvas::DataUpdated event for video_generated');
      eventBus.emit('Canvas::DataUpdated', {
        canvasId: canvasId,
        trigger: 'video_generated'
      })
    },
    [canvasId, sessionId]
  )

  const handleAudioGenerated = useCallback(
    (data: TEvents['Socket::Session::AudioGenerated']) => {
      if (
        data.canvas_id &&
        data.canvas_id !== canvasId &&
        data.session_id !== sessionId
      ) {
        return
      }

      console.log('🎵 dispatching audio_generated', data)
      setPending('audio')

      // Notify timeline to refresh data
      console.log('📤 Chat emitting Canvas::DataUpdated event for audio_generated');
      eventBus.emit('Canvas::DataUpdated', {
        canvasId: canvasId,
        trigger: 'audio_generated'
      })
    },
    [canvasId, sessionId]
  )

  const handleScriptGenerated = useCallback(
    (data: TEvents['Socket::Session::ScriptGenerated']) => {
      if ((data.canvas_id && data.canvas_id !== canvasId) || (data.session_id && data.session_id !== sessionId)) {
        return
      }

      console.log('📝 dispatching script_generated', data)

      // Notify timeline/canvas to refresh data
      console.log('📤 Chat emitting Canvas::DataUpdated event for script_generated')
      eventBus.emit('Canvas::DataUpdated', {
        canvasId: canvasId,
        trigger: 'script_generated',
      })
    },
    [canvasId, sessionId]
  )

  const handleAllMessages = useCallback(
    (data: TEvents['Socket::Session::AllMessages']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setMessages(() => {
        console.log('👇all_messages', data.messages)
        return filterMessages(data.messages)
      })

      console.log('📤 Chat emitting Canvas::DataUpdated event for history_sync')
      eventBus.emit('Canvas::DataUpdated', {
        canvasId: canvasId,
        trigger: 'history_sync',
      })

      scrollToBottom(true) // Force scroll to bottom when loading all messages
    },
    [canvasId, sessionId, scrollToBottom]
  )

  const handleDone = useCallback(
    (data: TEvents['Socket::Session::Done']) => {
      if (data.session_id && data.session_id !== sessionId) {
        return
      }

      setPending(false)
      scrollToBottom()

      // Note: No need to emit Canvas::DataUpdated for conversation_done
      // Timeline and canvas components now only refresh for actual content generation
      console.log('✅ Conversation completed - no refresh needed');
    },
    [sessionId, scrollToBottom, canvasId]
  )

  const handleError = useCallback((data: TEvents['Socket::Session::Error']) => {
    setPending(false)
    const raw = String(data.error || '')
    const httpMatch = raw.match(/HTTP\\s+(\\d{3})/i)
    const jsonStart = raw.indexOf('{')
    let shortMessage = raw
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart))
        if (parsed?.message) {
          shortMessage = httpMatch
            ? `HTTP ${httpMatch[1]}: ${parsed.message}`
            : String(parsed.message)
        }
      } catch (e) {}
    }

    toast.error(shortMessage || 'Error', {
      closeButton: true,
      duration: 3600 * 1000,
      style: { color: 'red', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '100%' },
    })
  }, [])

  const handleInfo = useCallback((data: TEvents['Socket::Session::Info']) => {
    if (data.session_id && data.session_id !== sessionId) {
      return
    }
    if (data.info === 'chat_cancelled') {
      setPending(false)
    }
    toast.info(data.info, {
      closeButton: true,
      duration: 10 * 1000,
    })
  }, [sessionId])

  useEffect(() => {
    const handleScroll = () => {
      if (scrollRef.current) {
        isAtBottomRef.current =
          scrollRef.current.scrollHeight - scrollRef.current.scrollTop <=
          scrollRef.current.clientHeight + 1
      }
    }
    const scrollEl = scrollRef.current
    scrollEl?.addEventListener('scroll', handleScroll)

    eventBus.on('Socket::Session::Delta', handleDelta)
    eventBus.on('Socket::Session::ToolCall', handleToolCall)
    eventBus.on('Socket::Session::ToolCallArguments', handleToolCallArguments)
    eventBus.on('Socket::Session::ToolResult', handleToolResult)
    eventBus.on('Socket::Session::ImageGenerated', handleImageGenerated)
    eventBus.on('Socket::Session::VideoGenerated', handleVideoGenerated)
    eventBus.on('Socket::Session::AudioGenerated', handleAudioGenerated)
    eventBus.on('Socket::Session::ScriptGenerated', handleScriptGenerated)
    eventBus.on('Socket::Session::AllMessages', handleAllMessages)
    eventBus.on('Socket::Session::Done', handleDone)
    eventBus.on('Socket::Session::Error', handleError)
    eventBus.on('Socket::Session::Info', handleInfo)
    return () => {
      scrollEl?.removeEventListener('scroll', handleScroll)

      eventBus.off('Socket::Session::Delta', handleDelta)
      eventBus.off('Socket::Session::ToolCall', handleToolCall)
      eventBus.off(
        'Socket::Session::ToolCallArguments',
        handleToolCallArguments
      )
      eventBus.off('Socket::Session::ToolResult', handleToolResult)
      eventBus.off('Socket::Session::ImageGenerated', handleImageGenerated)
      eventBus.off('Socket::Session::VideoGenerated', handleVideoGenerated)
      eventBus.off('Socket::Session::AudioGenerated', handleAudioGenerated)
      eventBus.off('Socket::Session::ScriptGenerated', handleScriptGenerated)
      eventBus.off('Socket::Session::AllMessages', handleAllMessages)
      eventBus.off('Socket::Session::Done', handleDone)
      eventBus.off('Socket::Session::Error', handleError)
      eventBus.off('Socket::Session::Info', handleInfo)
    }
  }, [
    handleDelta,
    handleToolCall,
    handleToolCallArguments,
    handleToolResult,
    handleImageGenerated,
    handleVideoGenerated,
    handleAudioGenerated,
    handleScriptGenerated,
    handleAllMessages,
    handleDone,
    handleError,
    handleInfo,
  ])

  const initChat = useCallback(async () => {
    if (!sessionId) {
      return
    }

    sessionIdRef.current = sessionId

    try {
      if (isShared) {
        // 分享模式：获取分享的聊天历史并准备重放
        const msgs = await getSharedChatHistory(sessionId)
        const messages = filterMessages(msgs?.length ? msgs : [])
        setReplayMessages(messages)
        setMessages([]) // 开始时清空消息
        setCurrentReplayIndex(0)
        setIsReplaying(false)
        setReplayCompleted(false)

        if (messages.length > 0) {
          setInitCanvas(false)
          // 自动启动重放
          setTimeout(() => {
            startReplay(messages)
          }, 500) // 稍微延迟一下，让UI先渲染
        }
      } else {
        // 正常模式：直接加载消息
        const msgs = await getChatSession(sessionId)
        const messages = filterMessages(msgs?.length ? msgs : [])
        setMessages(messages)
        setExpandingToolCalls([])
        if (messages.length > 0) {
          setInitCanvas(false)
        }
      }
    } catch (error) {
      console.error('Failed to load chat session:', error)
      setMessages([])
      setExpandingToolCalls([])
    }

    // Force scroll to bottom when initializing chat
    scrollToBottom(true)
  }, [sessionId, scrollToBottom, setInitCanvas, isShared])

  useEffect(() => {
    initChat()
  }, [sessionId, initChat])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (replayIntervalRef) {
        clearInterval(replayIntervalRef)
      }
    }
  }, [replayIntervalRef])

  // Auto scroll to bottom when messages change (for initial load)
  useEffect(() => {
    if (messages.length > 0) {
      // Set isAtBottomRef to true initially to ensure auto-scroll on first load
      isAtBottomRef.current = true
      scrollToBottom(true)
    }
  }, [messages.length, scrollToBottom])

  const onSelectSession = (sessionId: string) => {
    const nextSession = sessionList.find((s) => s.id === sessionId) || null
    if (!nextSession) {
      return
    }
    setSession(nextSession)
    window.history.pushState(
      {},
      '',
      buildCanvasUrl(canvasId, sessionId)
    )
  }

  const onClickNewChat = async () => {
    try {
      // 调用后端 API 创建新的 session
      const { session_id } = await createChatSession(canvasId, preferredLanguage)

      const newSession: Session = {
        id: session_id,
        title: t('chat:newChat'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        model: session?.model || 'gpt-4o',
        provider: session?.provider || 'openai',
      }

      setSessionList((prev) => [...prev, newSession])
      onSelectSession(newSession.id)
    } catch (error) {
      console.error('Failed to create new chat session:', error)
      toast.error(t('chat:errors.createSessionError'))
    }
  }

  const submitMessages = useCallback(
    async (data: Message[]) => {
      if (!sessionId) {
        return
      }

      setPending('text')
      setMessages(data)

      await sendMessages({
        sessionId: sessionId!,
        canvasId: canvasId,
        newMessages: data,
        preferredLanguage,
      })

      if (searchSessionId && searchSessionId !== sessionId) {
        window.history.pushState(
          {},
          '',
          buildCanvasUrl(canvasId, sessionId)
        )
      }

      scrollToBottom()
    },
    [canvasId, preferredLanguage, sessionId, searchSessionId, scrollToBottom]
  )

  const onSendMessages = useCallback(
    (data: Message[]) => {
      if (pending) {
        queuePausedRef.current = false
        const newUserMessages = data.slice(messages.length).filter((message) => message.role === 'user')
        if (newUserMessages.length === 0) {
          return
        }
        setQueuedUserMessages((prev) => [...prev, ...newUserMessages])
        scrollToBottom()
        return
      }

      void submitMessages(data).catch((error) => {
        console.error('Failed to send messages:', error)
        toast.error(t('common:errors.generic'))
      })
    },
    [messages.length, pending, scrollToBottom, submitMessages, t]
  )

  const handleCancelChat = useCallback(() => {
    queuePausedRef.current = true
    setQueuedUserMessages([])
    setPending(false)
  }, [])

  useEffect(() => {
    if (pending || queuedUserMessages.length === 0 || queuedMessageInFlightRef.current || queuePausedRef.current) {
      return
    }

    const nextUserMessages = queuedUserMessages
    const nextBatch = messages.concat(nextUserMessages)
    queuedMessageInFlightRef.current = true
    setQueuedUserMessages([])

    void submitMessages(nextBatch)
      .catch((error) => {
        console.error('Failed to flush queued messages:', error)
        setQueuedUserMessages(nextUserMessages)
      })
      .finally(() => {
        queuedMessageInFlightRef.current = false
      })
  }, [messages, pending, queuedUserMessages, submitMessages])

  const getMessageRenderKey = useCallback((message: Message, idx: number): string => {
    const messageMeta = message as Message & { id?: string; created_at?: string }
    const messageId = messageMeta.id
    const messageCreatedAt = messageMeta.created_at
    return messageId || `${message.role}-${messageCreatedAt || idx}-${idx}`
  }, [])

  return (
    <PhotoProvider>
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.48),transparent_36%),radial-gradient(circle_at_90%_18%,rgba(0,0,0,0.06),transparent_32%)] dark:bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.08),transparent_36%),radial-gradient(circle_at_90%_18%,rgba(255,255,255,0.05),transparent_32%)]">
        {/* Chat messages */}

        <header className="absolute top-0 z-10 flex w-full px-2 py-2">
          <SessionSelector
            session={session}
            sessionList={sessionList}
            onClickNewChat={onClickNewChat}
            onSelectSession={onSelectSession}
            isShared={isShared}
          />
          <Blur className="absolute top-0 left-0 right-0 h-full" />
        </header>

        <ScrollArea className="flex-1 min-h-0 w-full min-w-0" viewportRef={scrollRef}>
          {messages.length > 0 || queuedUserMessages.length > 0
            ? <div className="flex-1 px-4 pb-6 pt-16 w-full min-w-0 max-w-full overflow-x-hidden">
              {/* Messages */}
              {filterMessages(messages.concat(queuedUserMessages)).map((message, idx) => (
                <div key={getMessageRenderKey(message, idx)}>
                  {/* Regular message content */}
                  {typeof message.content == 'string' &&
                    (message.role !== 'tool' ? (
                      message.role === 'assistant' &&
                        message.tool_calls &&
                        !message.content
                        ? null
                        : (
                          <MessageRegular
                            message={message}
                            content={message.content}
                          />
                        )
                    ) : (
                      <ToolCallContent
                        expandingToolCalls={expandingToolCalls}
                        message={message}
                      />
                    ))}

                  {Array.isArray(message.content) &&
                    message.content.map((content, i) => (
                      <MessageRegular
                        key={`${getMessageRenderKey(message, idx)}-content-${i}`}
                        message={message}
                        content={content}
                      />
                    ))}

                  {message.role === 'assistant' &&
                    message.tool_calls &&
                    message.tool_calls.at(-1)?.function.name != 'finish' &&
                    message.tool_calls.map((toolCall) => {
                      return (
                        <ToolCallTag
                          key={toolCall.id || `${getMessageRenderKey(message, idx)}-${toolCall.function.name}-${toolCall.function.arguments?.slice(0, 32) || 'noargs'}`}
                          toolCall={toolCall}
                          isExpanded={toolCall.id ? expandingToolCalls.includes(toolCall.id) : false}
                          onToggleExpand={() => {
                            if (!toolCall.id) {
                              return
                            }
                            if (expandingToolCalls.includes(toolCall.id)) {
                              setExpandingToolCalls((prev) =>
                                prev.filter((id) => id !== toolCall.id)
                              )
                            } else {
                              setExpandingToolCalls((prev) => [
                                ...prev,
                                toolCall.id,
                              ])
                            }
                          }}
                        />
                      )
                    })}
                </div>
              ))}
              {sessionId && (
                <ToolcallProgressUpdate sessionId={sessionId} pending={pending} />
              )}
            </div>
            :
            <motion.div className="flex flex-col h-full p-4 items-start justify-start pt-16 select-none">
              <motion.span
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-muted-foreground text-3xl"
              >
                <ShinyText text={t('chat:welcome.greeting')} />
              </motion.span>
              <motion.span
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="text-muted-foreground text-2xl"
              >
                <ShinyText text={t('chat:welcome.help')} />
              </motion.span>
            </motion.div>
          }
        </ScrollArea>

        <div className="shrink-0 gap-2 p-2">
          {!isShared ? (
            <>
              <PlannerStatusPanel messages={messages} pending={pending} sessionId={sessionId} />
              {sessionId && <VideoGenerationGateDialog sessionId={sessionId} />}
              <ChatTextarea
                sessionId={sessionId!}
                pending={!!pending}
                messages={messages}
                showSleepButton
                queuedMessageCount={queuedUserMessages.length}
                onSendMessages={onSendMessages}
                onCancelChat={handleCancelChat}
              />
            </>
          ) : (
            <>
              {/* 分享模式 - 显示重放控制面板 */}
              <div className="flex flex-col gap-3 rounded-[1.2rem] border border-white/24 bg-white/26 p-4 shadow-[0_16px_42px_rgba(0,0,0,0.08)] backdrop-blur-[22px] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.24),rgba(12,12,11,0.16))]">
                <div className="flex items-center justify-center">
                  {isReplaying ? (
                    <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-white/52">
                      <div className="w-2 h-2 bg-neutral-700 rounded-full animate-pulse dark:bg-white/70"></div>
                      {t('chat:replay.replaying', { current: currentReplayIndex, total: replayMessages.length })}
                    </div>
                  ) : replayCompleted ? (
                    <div className="text-sm text-neutral-600 dark:text-white/52">
                      {t('chat:replay.completed')}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-600 dark:text-white/52">
                      {t('chat:replay.ready')}
                    </div>
                  )}
                </div>

                {/* 控制按钮 */}
                <div className="flex items-center justify-center gap-2">
                  {isReplaying ? (
                    /* 重放中 - 只显示Skip按钮 */
                    <Button
                      onClick={skipToEnd}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      <SkipForward className="w-4 h-4" />
                      {t('chat:replay.skipToEnd')}
                    </Button>
                  ) : replayCompleted ? (
                    /* 重放完成 - 显示Replay Again和Continue Conversation */
                    <>
                      <Button
                        onClick={replayAgain}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        {t('chat:replay.replayAgain')}
                      </Button>

                      {/* 继续对话按钮 - 只在重放完成后显示 */}
                      <Button
                        onClick={async () => {
                          setIsForking(true)
                          const toastId = toast.loading(t('chat:replay.forkingToast'))

                          try {
                            const { canvas_id, session_id } = await forkSession(sessionId!)
                            toast.success(t('chat:replay.forkSuccessToast'), { id: toastId })
                            router.replace(buildCanvasUrl(canvas_id, session_id))
                          } catch (error) {
                            console.error('Fork failed:', error)
                            toast.error(t('chat:replay.forkFailedToast'), { id: toastId })
                            setIsForking(false)
                          }
                        }}
                        variant="default"
                        size="sm"
                        className="flex items-center gap-2"
                        disabled={isForking}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {isForking ? t('chat:replay.forking') : t('chat:replay.continueConversation')}
                      </Button>
                    </>
                  ) : (
                    /* 初始状态 - 只显示Start Replay */
                    <Button
                      onClick={replayAgain}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      {t('chat:replay.startReplay')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </PhotoProvider>
  )
}

export default ChatInterface
