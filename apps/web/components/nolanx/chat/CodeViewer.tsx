"use client"

import React, { useMemo } from 'react'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useThemeContext } from '@/contexts/theme-context'
import { cn } from '@/lib/nolanx/utils/utils'

import jsonLang from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import bashLang from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import javascriptLang from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import typescriptLang from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import pythonLang from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import markdownLang from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'

SyntaxHighlighter.registerLanguage('json', jsonLang)
SyntaxHighlighter.registerLanguage('bash', bashLang)
SyntaxHighlighter.registerLanguage('sh', bashLang)
SyntaxHighlighter.registerLanguage('javascript', javascriptLang)
SyntaxHighlighter.registerLanguage('js', javascriptLang)
SyntaxHighlighter.registerLanguage('typescript', typescriptLang)
SyntaxHighlighter.registerLanguage('ts', typescriptLang)
SyntaxHighlighter.registerLanguage('python', pythonLang)
SyntaxHighlighter.registerLanguage('py', pythonLang)
SyntaxHighlighter.registerLanguage('markdown', markdownLang)
SyntaxHighlighter.registerLanguage('md', markdownLang)

export type CodeViewerProps = {
  code: string
  language?: string
  className?: string
  contentClassName?: string
  showLineNumbers?: boolean
  wrapLongLines?: boolean
}

export default function CodeViewer({
  code,
  language,
  className,
  contentClassName,
  showLineNumbers = false,
  wrapLongLines = true,
}: CodeViewerProps) {
  const { resolvedTheme } = useThemeContext()

  const syntaxTheme = useMemo(() => {
    return resolvedTheme === 'dark' ? oneDark : oneLight
  }, [resolvedTheme])

  return (
    <div
      className={cn(
        'w-full max-w-full min-w-0 overflow-hidden rounded-[1rem] border border-white/28 bg-white/26 dark:border-white/[0.06] dark:bg-white/[0.024]',
        className
      )}
    >
      <div className={cn('w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden', contentClassName)}>
        <SyntaxHighlighter
          language={(language || '').toLowerCase() || 'text'}
          style={syntaxTheme as any}
          showLineNumbers={showLineNumbers}
          wrapLongLines={wrapLongLines}
          wrapLines={wrapLongLines}
          lineProps={() => ({
            style: {
              display: 'block',
              whiteSpace: wrapLongLines ? 'pre-wrap' : 'pre',
              overflowWrap: 'anywhere',
              wordBreak: 'normal',
            },
          })}
          customStyle={{
            margin: 0,
            padding: 12,
            background: 'transparent',
            fontSize: 12,
            lineHeight: 1.5,
            width: '100%',
            boxSizing: 'border-box',
            maxWidth: '100%',
            minWidth: 0,
            overflowX: 'auto',
            whiteSpace: wrapLongLines ? 'pre-wrap' : 'pre',
            overflowWrap: 'anywhere',
            wordBreak: 'normal',
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              whiteSpace: wrapLongLines ? 'pre-wrap' : 'pre',
              overflowWrap: 'anywhere',
              wordBreak: 'normal',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}
