import { useEffect, useRef, useState, useCallback } from 'react'
import { intersectionObserverManager } from '@/lib/intersection-observer-manager'

interface UseIntersectionObserverOptions {
  rootMargin?: string
  threshold?: number
  onEnter?: () => void
  onExit?: () => void
}

export function useIntersectionObserver({
  rootMargin = '200px',
  threshold = 0.1,
  onEnter,
  onExit
}: UseIntersectionObserverOptions = {}) {
  const [isInView, setIsInView] = useState(false)
  const elementRef = useRef<HTMLDivElement>(null)
  const isInViewRef = useRef(false)

  // 使用 useCallback 确保回调函数稳定
  const handleEnter = useCallback(() => {
    if (!isInViewRef.current) {
      isInViewRef.current = true
      setIsInView(true)
      onEnter?.()
    }
  }, [onEnter])

  const handleExit = useCallback(() => {
    if (isInViewRef.current) {
      isInViewRef.current = false
      setIsInView(false)
      onExit?.()
    }
  }, [onExit])

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    // 使用全局管理器观察元素
    intersectionObserverManager.observe(
      element,
      {
        onEnter: handleEnter,
        onExit: handleExit,
      },
      {
        rootMargin,
        threshold,
      }
    )

    return () => {
      // 清理时取消观察
      intersectionObserverManager.unobserve(element)
    }
  }, [handleEnter, handleExit, rootMargin, threshold])

  return { elementRef, isInView }
}
