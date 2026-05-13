import { cn } from '@/lib/nolanx/utils/utils'
import { useTheme } from 'next-themes'
import React, { useEffect, useState, useMemo } from 'react'

interface HotkeyProps {
  keys: string[]
  modifier?: boolean
  isBackgroundDark?: boolean
}

export const Hotkey: React.FC<HotkeyProps> = ({
  keys,
  modifier = false,
  isBackgroundDark = false,
}) => {
  const [isMac, setIsMac] = useState(false)
  const { theme } = useTheme()

  // 只在组件挂载时检测一次操作系统
  useEffect(() => {
    setIsMac(window.navigator.userAgent.includes('Macintosh'))
  }, [])

  // 使用 useMemo 来避免不必要的重新计算
  // 使用 JSON.stringify 来比较数组内容而不是引用
  const displayKeys = useMemo(() => {
    const modifierKey = isMac ? '⌘' : '⌃'
    return modifier ? [modifierKey, ...keys] : keys
  }, [modifier, JSON.stringify(keys), isMac])

  const isDarkTheme = theme === 'dark'

  const bgGradient = isDarkTheme
    ? 'bg-gradient-to-bl from-transparent via-transparent to-background/20'
    : 'bg-gradient-to-bl from-transparent via-transparent to-white/20'

  return (
    <span
      className={cn(
        'inline-flex gap-[2px]',
        isBackgroundDark ? 'text-background' : 'text-foreground'
      )}
    >
      {displayKeys.map((key, index) => (
        <kbd
          key={index}
          suppressHydrationWarning
          className={cn(
            'inline-flex items-center justify-center rounded border border-border font-sans text-[10px] font-medium h-4 w-4',
            index === 0 ? 'ml-2' : 'ml-[1px]',
            bgGradient,
            'bg-[length:100%_130%] bg-[0_100%]'
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
