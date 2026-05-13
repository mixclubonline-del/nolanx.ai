import { Button } from '../ui/button'
import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import React, { memo, useState, useEffect } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import ReactMarkdown, { Components } from 'react-markdown'
import { PhotoView } from 'react-photo-view'
import remarkGfm from 'remark-gfm'
import TextFoldTag from './Message/TextFoldTag'
import JsonCard from './JsonCard'
import CodeViewer from './CodeViewer'
import { segmentRichText } from './segment-rich-text'

type MarkdownProps = {
  children: string
}

const NonMemoizedMarkdown: React.FC<MarkdownProps> = ({ children }) => {
  const { excalidrawAPI } = useCanvas()
  const files = excalidrawAPI?.getFiles()
  const filesArray = Object.keys(files || {}).map((key) => ({
    id: key,
    url: files![key].dataURL,
  }))

  const { t } = useTranslation()
  const [isThinkExpanded, setIsThinkExpanded] = useState(false)

  const hasUnclosedThinkTags = (text: string): boolean => {
    const openTags = (text.match(/<think>/g) || []).length
    const closeTags = (text.match(/<\/think>/g) || []).length
    return openTags > closeTags
  }


  const fixUnclosedThinkTags = (text: string): string => {
    const openTags = (text.match(/<think>/g) || []).length
    const closeTags = (text.match(/<\/think>/g) || []).length

    if (openTags > closeTags) {
      return text + '</think>'.repeat(openTags - closeTags)
    }
    return text
  }


  const shouldAutoExpand = hasUnclosedThinkTags(children)


  useEffect(() => {
    if (shouldAutoExpand) {
      setIsThinkExpanded(true)
    } else {
      setIsThinkExpanded(false)
    }
  }, [shouldAutoExpand])


  const processThinkTags = (content: string) => {
    // 首先移除所有空的think标签（包括只含空格的）
    const cleanedContent = content.replace(/<think>\s*<\/think>/g, '')
    const fixedContent = fixUnclosedThinkTags(cleanedContent)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g
    const parts = []
    let lastIndex = 0
    let match

    while ((match = thinkRegex.exec(fixedContent)) !== null) {
      if (match.index > lastIndex) {
        const beforeContent = fixedContent.slice(lastIndex, match.index).trim()
        if (beforeContent) {
          parts.push({ type: 'normal', content: beforeContent })
        }
      }

      const thinkContent = match[1]?.trim()
      if (thinkContent) {
        parts.push({ type: 'think', content: thinkContent })
      }
      // 不显示空的think标签
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < fixedContent.length) {
      const remainingContent = fixedContent.slice(lastIndex).trim()
      if (remainingContent) {
        parts.push({ type: 'normal', content: remainingContent })
      }
    }

    if (parts.length === 0 && fixedContent.trim()) {
      parts.push({ type: 'normal', content: fixedContent.trim() })
    }

    console.log('Think tags processing:', { parts, originalContent: children.substring(0, 100) })

    return parts
  }

  const looksLikeStructuredBlob = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return false

    const lineCount = trimmed.split('\n').filter(Boolean).length
    if (lineCount < 4) return false

    const hasJsonSignals =
      trimmed.includes(':') &&
      trimmed.includes('"') &&
      /[{}\[\]]/.test(trimmed)

    return hasJsonSignals
  }

  const handleImagePositioning = (id: string) => {
    excalidrawAPI?.scrollToContent(id, { animate: true })
  }

  // 规范化媒体/链接 URL，移除前缀并修复协议
  const normalizeUrl = (url?: string) => {
    if (!url) return ''
    let s = (url || '').trim()
    // 去掉常见前缀
    s = s.replace(/^video_url\s*:/i, '').replace(/^image_url\s*:/i, '').replace(/^audio_url\s*:/i, '').trim()
    // 修复单斜杠协议
    s = s.replace(/^https:\/([^/])/i, 'https://$1').replace(/^http:\/([^/])/i, 'http://$1')
    // 若仍非绝对 HTTP(S) 链接，直接返回原值（避免被当相对路径时的错误再加工）
    return s
  }

  const isVideoHref = (href?: string) => {
    const s = normalizeUrl(href).toLowerCase()
    return /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/.test(s)
  }
  const isAudioHref = (href?: string) => {
    const s = normalizeUrl(href).toLowerCase()
    return /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/.test(s)
  }

  const components: Components = {
    pre: ({ node, children }) => {
      return (
        <div className="not-prose w-full max-w-full min-w-0 overflow-x-hidden">
          {children}
        </div>
      )
    },
    code: ({ node, className, children, ref, ...props }) => {
      const match = /language-(\w+)/.exec(className || '')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isInline = Boolean((props as any).inline)
      const codeText = React.Children.toArray(children)
        .map((child) => (typeof child === 'string' ? child : String(child)))
        .join('')
        .replace(/\n$/, '')

      if (isInline) {
        return (
          <code
            className={`${className} overflow-x-auto whitespace-pre-wrap rounded-md bg-white/40 px-1 py-0.5 text-sm text-black break-all dark:bg-white/[0.024] dark:text-white/86`}
            {...props}
          >
            {children}
          </code>
        )
      }

      const lang = (match?.[1] || '').toLowerCase()
      const trimmed = codeText.trim()
      if (lang === 'json' || (!lang && (trimmed.startsWith('{') || trimmed.startsWith('[')))) {
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed && (Array.isArray(parsed) || typeof parsed === 'object')) {
            return <JsonCard value={parsed} raw={trimmed} className="my-2" />
          }
        } catch {}
      }

      return (
        <div className="not-prose my-2 w-full max-w-full min-w-0">
          <CodeViewer code={codeText} language={lang || undefined} />
        </div>
      )
    },

    ol: ({ node, children, ...props }) => (
      <ol className="list-decimal list-inside ml-1" {...props}>{children}</ol>
    ),
    li: ({ node, children, ...props }) => (
      <li className="py-1 [&>p]:inline [&>p]:m-0" {...props}>{children}</li>
    ),
    ul: ({ node, children, ...props }) => (
      <ul className="list-disc list-inside ml-1" {...props}>{children}</ul>
    ),
    strong: ({ node, children, ...props }) => (
      <span className="font-bold" {...props}>{children}</span>
    ),

    a: ({ node, children, ...props }) => {
      const href = normalizeUrl(props.href)
      if (isVideoHref(href)) {
        return (
          <span className="group block relative overflow-hidden rounded-md my-2 last:mb-4 w-full max-w-full min-w-0">
            <video
              className="w-full rounded-md"
              controls
              autoPlay
              muted
              loop
              playsInline
              src={href}
            >
              Your browser does not support the video tag.
            </video>
            <span className="text-sm text-gray-500 mt-1 block">
              {children || href}
            </span>
          </span>
        )
      }
      if (isAudioHref(href)) {
        return (
          <span className="group block relative overflow-hidden rounded-md my-2 last:mb-4 w-full max-w-full min-w-0">
            <audio className="w-full" controls preload="metadata" src={href}>
              Your browser does not support the audio tag.
            </audio>
            <span className="text-sm text-gray-500 mt-1 block">
              {children || href}
            </span>
          </span>
        )
      }
      // 普通链接处理
      return (
        <a className="text-blue-500 hover:underline break-all" target="_blank" rel="noreferrer" href={href}>
          {children}
        </a>
      )
    },
    h1: ({ node, children, ...props }) => {
      return (
        <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
          {children}
        </h1>
      )
    },
    h2: ({ node, children, ...props }) => {
      return (
        <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
          {children}
        </h2>
      )
    },
    h3: ({ node, children, ...props }) => {
      return (
        <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
          {children}
        </h3>
      )
    },
    h4: ({ node, children, ...props }) => {
      return (
        <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
          {children}
        </h4>
      )
    },
    h5: ({ node, children, ...props }) => {
      return (
        <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
          {children}
        </h5>
      )
    },
    h6: ({ node, children, ...props }) => {
      return (
        <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
          {children}
        </h6>
      )
    },
    blockquote: ({ node, children, ...props }) => {
      return (
        <blockquote
          className="border-l-3 border-b-accent-foreground pl-4 py-2"
          {...props}
        >
          {children}
        </blockquote>
      )
    },
    p: ({ node, children, ...props }) => {
      // 检查子元素是否包含div（视频/音频/图片容器）
      const hasBlockElements = React.Children.toArray(children).some(child => {
        if (!React.isValidElement(child)) return false;

        // 检查是否是div元素
        if (child.type === 'div') return true;

        // 检查是否有group block类名（用于视频/音频/图片容器）
        const childProps = child.props as any;
        return childProps?.className?.includes?.('group block');
      });

      // 如果包含块级元素，使用div而不是p
      if (hasBlockElements) {
        return <div className="my-2" {...props}>{children}</div>;
      }

      // 普通段落
      return <p className="my-2 leading-relaxed" {...props}>{children}</p>;
    },
    img: ({ node, children, ...props }) => {
      const rawSrc = String(props.src || '')
      const src = normalizeUrl(rawSrc)
      const id = filesArray.find((file) => src?.includes(file.url))?.id

      // 更精确的视频/音频文件检测 - 使用规范化后的 URL
      const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(src)
      const isAudioFromAlt = /audio_url:/i.test(String(props.alt || ''))
      const isAudioFromUrl = /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(src)
      const isAudio = isAudioFromAlt || isAudioFromUrl

      if (isVideo) {
        // 仅当 alt 是合法 URL 时作为 poster
        const altUrl = normalizeUrl(String(props.alt || ''))
        const poster = /^https?:\/\//i.test(altUrl) ? altUrl : undefined
        return (
          <div className="group block relative overflow-hidden rounded-md my-2 last:mb-4 w-full max-w-full min-w-0">
            <video
              className="w-full rounded-md"
              controls
              autoPlay
              muted
              loop
              playsInline
              src={src}
              poster={poster}
            >
              Your browser does not support the video tag.
            </video>

            {id && (
              <Button
                variant="secondary"
                className="group-hover:opacity-100 opacity-0 absolute top-2 right-2 z-10"
                onClick={(e) => {
                  e.stopPropagation()
                  handleImagePositioning(id)
                }}
              >
                {t('chat:messages.videoPositioning')}
              </Button>
            )}
          </div>
        )
      }

      if (isAudio) {
        return (
          <div className="group block relative overflow-hidden rounded-md my-2 last:mb-4 w-full max-w-full min-w-0">
            <audio className="w-full" controls preload="metadata" src={src}>
              Your browser does not support the audio tag.
            </audio>
            <span className="text-sm text-gray-500 mt-1 block">
              {String(props.alt || src)}
            </span>
          </div>
        )
      }

      // 普通图片：使用规范化后的 src
      return (
        <PhotoView src={src}>
          <span className="group block relative overflow-hidden rounded-md my-2 last:mb-4 w-full max-w-full min-w-0">
            <img
              className="cursor-pointer group-hover:scale-105 transition-transform duration-300 w-full"
              src={src}
              alt={String(props.alt || '')}
            />

            {id && (
              <Button
                variant="secondary"
                className="group-hover:opacity-100 opacity-0 absolute top-2 right-2 z-10"
                onClick={(e) => {
                  e.stopPropagation()
                  handleImagePositioning(id)
                }}
              >
                {t('chat:messages.imagePositioning')}
              </Button>
            )}
          </span>
        </PhotoView>
      )
    },
  }

  const renderRich = (text: string) => {
    const segments = segmentRichText(text)
    return (
      <div className="space-y-3 w-full max-w-full min-w-0 overflow-x-hidden">
        {segments.map((seg, idx) => {
          if (seg.type === 'json') {
            return (
              <JsonCard
                key={`json-${idx}`}
                value={seg.value}
                raw={seg.raw}
                repeat={seg.repeat}
              />
            )
          }
          return (
            <div key={`md-${idx}`} className="w-full max-w-full min-w-0">
              {looksLikeStructuredBlob(seg.content) ? (
                <CodeViewer code={seg.content.trim()} language="text" />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                  {seg.content}
                </ReactMarkdown>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // 如果内容包含think标签，进行特殊处理
  if (children.includes('<think>')) {
    const parts = processThinkTags(children)

    return (
      <div className="space-y-3 flex flex-col w-full max-w-full">
        {parts.map((part, index) => (
          part.type === 'think' ? (
            <TextFoldTag
              key={index}
              isExpanded={isThinkExpanded}
              onToggleExpand={() => setIsThinkExpanded(!isThinkExpanded)}
            >
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {renderRich(part.content)}
              </div>
            </TextFoldTag>
          ) : (
            <div key={index} className="w-full max-w-full">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {renderRich(part.content)}
              </div>
            </div>
          )
        ))}
      </div>
    )
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none w-full min-w-0 overflow-x-hidden [&>p]:m-0 [&>p]:leading-relaxed">
      {renderRich(children)}
    </div>
  )
}

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children
)
