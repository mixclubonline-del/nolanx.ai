import ThemeButton from '@/components/nolanx/theme/ThemeButton'
import { Input } from '../ui/input'
import { ChevronLeft } from 'lucide-react'
import { motion } from 'motion/react'
import React from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'

type CanvasHeaderProps = {
  canvasName: string
  canvasId: string
  sessionId?: string
  sessionTitle?: string
  canvasData?: any
  onNameChange: (name: string) => void
  onNameSave: () => void
  onBackToHome?: () => void
  isShared?: boolean
}

const CanvasHeader: React.FC<CanvasHeaderProps> = ({
  canvasName,
  canvasId,
  sessionId,
  sessionTitle,
  canvasData,
  onNameChange,
  onNameSave,
  onBackToHome,
  isShared = false,
}) => {
  const { t } = useTranslation()

  return (
    <motion.div
      className="sticky top-0 z-50 flex h-14 w-full items-center justify-between border-b border-white/35 bg-white/62 px-2.5 py-1.5 backdrop-blur-2xl select-none dark:border-white/10 dark:bg-black/58 md:h-16 md:px-4"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
    >
      <motion.div
        className="group flex cursor-pointer items-center gap-2 rounded-full border border-white/36 bg-white/28 px-2 py-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-colors hover:bg-white/38 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] md:px-3"
        onClick={onBackToHome}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <ChevronLeft className="size-5 text-neutral-600 transition-transform duration-300 group-hover:-translate-x-1 dark:text-white/62" />
        <div className="flex size-8 items-center justify-center rounded-full border border-white/40 bg-white/38 shadow-inner dark:border-white/10 dark:bg-white/[0.08] md:size-9">
          <span className="text-xs font-bold text-neutral-800 dark:text-white md:text-sm">N</span>
        </div>
      </motion.div>

      <div className="flex items-center gap-2 md:gap-3 flex-1 justify-center max-w-[50%] md:max-w-none">
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="relative w-full overflow-hidden rounded-full border border-white/36 bg-white/28 shadow-[0_12px_34px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] md:w-auto"
        >
          <Input
            className="h-8 w-full rounded-full border-none bg-transparent px-3 text-center text-sm font-medium text-neutral-800 shadow-none transition-all hover:bg-white/16 dark:text-white/82 dark:hover:bg-white/[0.06] md:w-fit md:px-4 md:text-base"
            value={canvasName}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onNameSave}
            placeholder={t('canvas:header.sceneTitlePlaceholder')}
          />
        </motion.div>
      </div>

      {!isShared && (
        <div className="flex items-center gap-1 rounded-full border border-white/36 bg-white/24 px-1.5 py-1 shadow-[0_12px_34px_rgba(0,0,0,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] md:px-2">
          <ThemeButton />
        </div>
      )}
      {isShared && (
        <div className="flex items-center gap-2 rounded-full border border-white/36 bg-white/24 px-3 py-1.5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]">
          <ThemeButton />
          <span className="text-sm text-neutral-500 dark:text-white/58">
            {t('canvas:header.sharedCanvas')}
          </span>
        </div>
      )}
    </motion.div>
  )
}

export default CanvasHeader
