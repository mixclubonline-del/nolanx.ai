import { listCanvases } from '@/lib/nolanx/api/canvas'
import type { CanvasItem } from '@/lib/nolanx/api/canvas'
import CanvasCard from './CanvasCard'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { useLocale } from 'next-intl'
import { localizePathname } from '@/i18n/pathname'
import { useEffect } from 'react'
import { Button } from '../ui/button'

const CanvasList: React.FC = () => {
  const { t } = useTranslation()
  const locale = useLocale()
  const appLocale = locale === 'zh-CN' ? 'zh-CN' : 'en'
  const router = useRouter()
  const queryClient = useQueryClient()
  const {
    data: canvases,
    refetch,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['canvases'],
    queryFn: listCanvases,
    staleTime: 15_000,
  })

  useEffect(() => {
    canvases?.slice(0, 8).forEach((canvas) => {
      router.prefetch(localizePathname(`/canvas/${canvas.id}`, appLocale))
    })
  }, [appLocale, canvases, router])

  const handleCanvasClick = (id: string, path?: string) => {
    router.push(path ?? localizePathname(`/canvas/${id}`, appLocale))
  }

  const handleDeleteCanvas = (id: string) => {
    queryClient.setQueryData<CanvasItem[]>(['canvases'], (current) =>
      current ? current.filter((canvas) => canvas.id !== id) : current
    )
    void queryClient.invalidateQueries({ queryKey: ['canvases'] })
  }

  if (isLoading && !canvases) {
    return (
      <div className="flex flex-col px-4 md:px-10 mt-8 md:mt-16 gap-6 md:gap-8 select-none max-w-[1200px] mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 w-full">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[1.6rem] border border-white/34 bg-white/26 p-4 shadow-[0_18px_52px_rgba(0,0,0,0.09)] backdrop-blur-[24px] dark:border-white/[0.06] dark:bg-transparent"
            >
              <div className="h-40 animate-pulse rounded-[1.15rem] bg-white/34 dark:bg-transparent" />
              <div className="mt-3 h-5 w-2/3 animate-pulse rounded-full bg-white/34 dark:bg-transparent" />
              <div className="mt-2 h-4 w-1/3 animate-pulse rounded-full bg-white/24 dark:bg-transparent" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col px-4 md:px-10 mt-8 md:mt-16 gap-4 select-none max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between gap-4 rounded-[1.6rem] border border-red-200/70 bg-white/46 p-5 shadow-[0_18px_52px_rgba(0,0,0,0.08)] backdrop-blur-[24px] dark:border-red-300/14 dark:bg-transparent">
          <div className="text-sm text-neutral-700 dark:text-white/74">
            {locale === 'zh-CN' ? '加载画布失败，请重试。' : 'Failed to load canvases. Please retry.'}
          </div>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common:buttons.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      </div>
    )
  }

  if (!canvases || canvases.length === 0) {
    return (
      <div className="flex flex-col px-4 md:px-10 mt-8 md:mt-16 gap-4 select-none max-w-[1200px] mx-auto">
        <div className="rounded-[1.6rem] border border-white/34 bg-white/26 p-6 text-sm text-neutral-600 shadow-[0_18px_52px_rgba(0,0,0,0.08)] backdrop-blur-[24px] dark:border-white/[0.06] dark:bg-transparent dark:text-white/64">
          {locale === 'zh-CN' ? '还没有画布，先创建一个。' : 'No canvases yet. Create one to get started.'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col px-4 md:px-10 mt-8 md:mt-16 gap-6 md:gap-8 select-none max-w-[1200px] mx-auto">
      {canvases && canvases.length > 0 && (
        <>
          <AnimatePresence>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 w-full">
              {canvases?.map((canvas, index) => (
                <CanvasCard
                  key={canvas.id}
                  index={index}
                  canvas={canvas}
                  handleCanvasClick={handleCanvasClick}
                  handleDeleteCanvas={handleDeleteCanvas}
                />
              ))}
            </div>
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

export default CanvasList
export { CanvasList }
