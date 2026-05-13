import { Button } from '../../ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../ui/tooltip'
import { cn } from '@/lib/nolanx/utils/utils'
import React, { useState, useEffect } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import icons, { toolShortcuts, ToolType } from './CanvasMenuIcon'

type CanvasMenuButtonProps = {
  type: ToolType
  active?: boolean
  activeTool?: ToolType
  onClick?: () => void
}

const CanvasMenuButton = ({
  type,
  active,
  activeTool,
  onClick,
}: CanvasMenuButtonProps) => {
  const { t } = useTranslation()
  const [isMounted, setIsMounted] = useState(false)
  const isActive = activeTool === type || active

  // 确保只在客户端渲染翻译内容，避免 SSR 水合错误
  useEffect(() => {
    setIsMounted(true)
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'p-2 rounded-md cursor-pointer hover:bg-primary/5',
            isActive && 'bg-primary/10'
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            onClick?.()
          }}
        >
          {React.createElement(icons[type], {
            className: 'size-4',
          })}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isMounted ? t(`canvas:tool.${type}`) : type} ({toolShortcuts[type]})
      </TooltipContent>
    </Tooltip>
  )
}

export default CanvasMenuButton
