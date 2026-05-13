import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';
import { useState, useEffect } from 'react';

/**
 * SSR安全的翻译Hook
 * 解决服务端渲染和客户端水合时翻译内容不一致的问题
 */
export function useSSRSafeTranslation() {
  const { t, i18n } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  /**
   * SSR安全的翻译函数
   * @param key 翻译键
   * @param fallback 服务端渲染时的备用文本（通常使用英文）
   * @param options 翻译选项
   * @returns 翻译后的文本
   */
  const safeT = (key: string, fallback: string, options?: any): string => {
    if (!isMounted) {
      return fallback;
    }
    const result = t(key, options);
    return typeof result === 'string' ? result : fallback;
  };

  return {
    t: safeT,
    isMounted,
    i18n,
    // 原始的翻译函数，用于特殊情况
    originalT: t,
  };
}
