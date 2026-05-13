import { cn } from '@/lib/nolanx/utils/utils'
import { ChevronUpIcon, Maximize2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ReactNode } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'

type TextFoldTagProps = {
  children: ReactNode
  isExpanded: boolean
  onToggleExpand: () => void
  buttonText?: string
  onOpenFullscreen?: () => void
}

const TextFoldTag: React.FC<TextFoldTagProps> = ({
  children,
  isExpanded,
  onToggleExpand,
  buttonText,
  onOpenFullscreen,
}) => {
  const { t } = useTranslation()
  return (
    <div className="mb-4 max-w-full overflow-hidden rounded-[1.6rem] border border-white/34 bg-white/28 shadow-[0_16px_46px_rgba(0,0,0,0.08)] backdrop-blur-[22px] transition-all duration-300 hover:shadow-[0_22px_56px_rgba(0,0,0,0.12)] dark:border-white/[0.06] dark:bg-transparent dark:shadow-[0_20px_56px_rgba(0,0,0,0.24)]">
      <div
        className="flex cursor-pointer items-center justify-between p-4 transition-colors duration-200 hover:bg-white/12 dark:hover:bg-white/[0.045]"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-white/40 bg-white/34 p-2 text-neutral-700 backdrop-blur-sm dark:border-white/[0.06] dark:bg-transparent dark:text-white/78">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path clipRule="evenodd" fillRule="evenodd" d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.721 6.721 0 0 0 3.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 0 1-.814 1.686.75.75 0 0 0 .44 1.223ZM8.25 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Zm4.875-1.125a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z"></path>
            </svg>
          </div>
          <p className="text-sm font-semibold text-neutral-800 dark:text-white/92">
            {buttonText || t('chat:thinking.title')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenFullscreen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenFullscreen()
              }}
              className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-white/30 hover:text-neutral-700 dark:text-white/52 dark:hover:bg-white/[0.045] dark:hover:text-white/82"
              aria-label={t('chat:thinking.expand')}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <ChevronUpIcon
            className={cn(
              isExpanded && 'rotate-180',
              'h-4 w-4 text-neutral-500 transition-transform duration-300 dark:text-white/52'
            )}
          />
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/28 dark:border-white/[0.06]">
              <div className="max-w-full overflow-hidden p-3 text-sm leading-relaxed text-neutral-700 dark:text-white/78">
                {children}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default TextFoldTag
