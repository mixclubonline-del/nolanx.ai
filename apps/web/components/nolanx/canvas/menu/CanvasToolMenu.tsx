import { Separator } from '../../ui/separator'
import { useCanvas } from '@/lib/nolanx/contexts/canvas'
import { useState } from 'react'
import CanvasMenuButton from './CanvasMenuButton'
import { ToolType } from './CanvasMenuIcon'

const CanvasToolMenu = () => {
  const { excalidrawAPI } = useCanvas()

  const [activeTool, setActiveTool] = useState<ToolType | undefined>('hand')

  const handleToolChange = (tool: ToolType) => {
    excalidrawAPI?.setActiveTool({ type: tool })
  }

  excalidrawAPI?.onChange((_elements, appState, _files) => {
    setActiveTool(appState.activeTool.type as ToolType)
  })

  // 🔧 只保留需要的工具：Camera Pan (H), Scene Select (V), Title Card (T), Visual Asset (9)
  const tools: (ToolType | null)[] = [
    'hand',      // Camera Pan (H) - 画布移动
    'selection', // Scene Select (V) - 选中工具
    // 'text',      // Title Card (T) - 文本工具
    'image',     // Visual Asset (9) - 图片工具
  ]

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-99 flex items-center gap-1 bg-primary-foreground/75 backdrop-blur-lg rounded-lg p-1 shadow-[0_5px_10px_rgba(0,0,0,0.08)] border border-primary/10">
      {tools.map((tool, index) =>
        tool ? (
          <CanvasMenuButton
            key={tool}
            type={tool}
            activeTool={activeTool}
            onClick={() => handleToolChange(tool)}
          />
        ) : (
          <Separator
            key={index}
            orientation="vertical"
            className="h-6! bg-primary/5"
          />
        )
      )}
    </div>
  )
}

export default CanvasToolMenu
