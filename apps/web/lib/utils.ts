import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 复制文本到剪贴板
export async function copyToClipboard(text: string): Promise<boolean> {
  // 只在浏览器环境中执行
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      // 使用现代Clipboard API
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // 回退到旧方法
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const result = document.execCommand('copy');
      document.body.removeChild(textArea);
      return result;
    }
  } catch (error) {
    console.error("Failed to copy text:", error);
    return false;
  }
}

// Format date to readable "time ago" format
export const formatTimeAgo = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

// Format bytes to human-readable format
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return "0 Bytes"

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB"]

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

/**
 * Formats a date string into a localized, human-readable format
 * @param dateString - ISO date string
 * @returns Formatted date string
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * 计算文章的预估阅读时间（分钟）
 * @param text - 文章内容文本 
 * @param wordsPerMinute - 平均阅读速度（每分钟字数）
 * @returns 预估阅读时间（分钟）
 */
export function calculateReadingTime(text: string, wordsPerMinute = 200): number {
  // 移除所有的Markdown标记
  const plainText = text
    .replace(/!\[.*?\]\(.*?\)/g, '') // 图片
    .replace(/\[.*?\]\(.*?\)/g, '$1') // 链接
    .replace(/[#*_~`>]/g, '') // 其他Markdown标记
    .replace(/\n/g, ' '); // 换行符替换为空格

  // 计算单词数量（按空格分隔）
  const wordCount = plainText.trim().split(/\s+/).length;

  // 计算阅读时间（分钟）
  const readingTime = Math.ceil(wordCount / wordsPerMinute);

  // 确保至少为1分钟
  return Math.max(1, readingTime);
}


// 带有错误处理的安全播放尝试
export const safePlayAttempt = async (videoElement: HTMLVideoElement, cb: (res: boolean) => void): Promise<boolean> => {
  // 只在浏览器环境中执行
  if (typeof window === 'undefined' || !videoElement) return false;

  try {
    // 增加播放前的用户交互检测
    if (document.visibilityState === 'visible') {
      const playPromise = videoElement.play();
      if (playPromise !== undefined) {
        await playPromise;
        cb(false);
        return true;
      }
    }
  } catch (err) {
    // 根据错误类型执行不同操作
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        // Chrome省电模式中断播放，记录但不视为严重错误
        cb(true);
      } else if (err.name === 'NotAllowedError') {
        // 自动播放政策阻止，通常需要用户交互
        cb(true);
      } else {
        // 其他错误
        console.error('video play error:', err);
      }
    } else {
      console.error('video play error:', err);
    }
  }
  return false;
};