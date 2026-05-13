/**
 * 统一的视频缓存管理器
 * 解决重复下载问题，提供预加载和进度跟踪功能
 */

import {
  buildTimelineVideoProxyRequest,
  getTimelineVideoSourceCandidates,
  shouldUseTimelineVideoProxy,
} from '@/lib/utils/videoUrl';

export type VideoLoadMode = 'direct' | 'timeline';

export interface VideoCache {
  url: string;
  blob?: Blob;
  objectUrl?: string;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  progress: number;
  loadPromise?: Promise<void>;
  lastAccessed: number;
  priority: number;
}

export interface VideoLoadProgress {
  url: string;
  loaded: number;
  total: number;
  progress: number;
  status?: VideoCache['status'];
}

interface QueuedVideoLoad {
  url: string;
  priority: number;
  mode: VideoLoadMode;
  order: number;
}

class VideoCacheManager {
  private cache = new Map<string, VideoCache>();
  private maxCacheSize = 50;
  private maxCacheSizeMB = 500;
  private currentCacheSizeMB = 0;
  private loadingQueue = new Set<string>();
  private progressCallbacks = new Map<string, Set<(progress: VideoLoadProgress) => void>>();
  private pendingQueue: QueuedVideoLoad[] = [];
  private activePreloads = 0;
  private maxConcurrentPreloads = 2;
  private queueOrder = 0;
  private lastProxyFailureAt = new Map<string, number>();

  async getVideo(url: string, priority: number = 5, mode: VideoLoadMode = 'direct'): Promise<string | null> {
    if (!url) {
      return null;
    }

    const cached = this.cache.get(url);
    if (cached) {
      cached.lastAccessed = Date.now();

      if (cached.status === 'loaded' && cached.objectUrl) {
        return cached.objectUrl;
      }

      if (cached.status === 'loading' && cached.loadPromise) {
        await cached.loadPromise;
        return cached.objectUrl || null;
      }
    }

    return this.loadVideo(url, priority, mode);
  }

  preloadVideo(url: string, priority: number = 3, mode: VideoLoadMode = 'direct'): void {
    if (!url || this.loadingQueue.has(url)) {
      return;
    }

    const existingQueued = this.pendingQueue.find((item) => item.url === url);
    if (existingQueued) {
      existingQueued.priority = Math.max(existingQueued.priority, priority);
      if (mode === 'timeline') {
        existingQueued.mode = 'timeline';
      }

      const cached = this.cache.get(url);
      if (cached) {
        cached.lastAccessed = Date.now();
        cached.priority = Math.max(cached.priority, priority);
      }
      return;
    }

    const cached = this.cache.get(url);
    if (cached && cached.status !== 'error') {
      cached.lastAccessed = Date.now();
      cached.priority = Math.max(cached.priority, priority);
      return;
    }

    this.cache.set(url, {
      url,
      status: 'pending',
      progress: 0,
      lastAccessed: Date.now(),
      priority,
    });

    this.notifyProgress(url, { url, loaded: 0, total: 0, progress: 0, status: 'pending' });

    this.pendingQueue.push({
      url,
      priority,
      mode,
      order: this.queueOrder++,
    });

    this.processPendingQueue();
  }

  preloadVideos(urls: Array<{ url: string; priority: number; mode?: VideoLoadMode }>): void {
    const sortedUrls = urls
      .filter((item) => Boolean(item.url))
      .sort((a, b) => b.priority - a.priority);

    sortedUrls.forEach((item) => {
      this.preloadVideo(item.url, item.priority, item.mode || 'direct');
    });
  }

  onProgress(url: string, callback: (progress: VideoLoadProgress) => void): () => void {
    if (!this.progressCallbacks.has(url)) {
      this.progressCallbacks.set(url, new Set());
    }

    this.progressCallbacks.get(url)!.add(callback);

    return () => {
      const callbacks = this.progressCallbacks.get(url);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.progressCallbacks.delete(url);
        }
      }
    };
  }

  getVideoStatus(url: string): VideoCache | null {
    return this.cache.get(url) || null;
  }

  clearCache(): void {
    for (const cached of this.cache.values()) {
      if (cached.objectUrl) {
        URL.revokeObjectURL(cached.objectUrl);
      }
    }

    this.cache.clear();
    this.currentCacheSizeMB = 0;
    this.loadingQueue.clear();
    this.progressCallbacks.clear();
    this.pendingQueue = [];
    this.activePreloads = 0;
  }

  getCacheStats() {
    const stats = {
      totalVideos: this.cache.size,
      loadedVideos: 0,
      loadingVideos: 0,
      errorVideos: 0,
      totalSizeMB: this.currentCacheSizeMB,
      maxSizeMB: this.maxCacheSizeMB,
    };

    for (const cached of this.cache.values()) {
      switch (cached.status) {
        case 'loaded':
          stats.loadedVideos++;
          break;
        case 'loading':
        case 'pending':
          stats.loadingVideos++;
          break;
        case 'error':
          stats.errorVideos++;
          break;
      }
    }

    return stats;
  }

  private processPendingQueue(): void {
    if (this.activePreloads >= this.maxConcurrentPreloads) {
      return;
    }

    this.pendingQueue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.order - b.order;
    });

    while (this.activePreloads < this.maxConcurrentPreloads && this.pendingQueue.length > 0) {
      const nextItem = this.pendingQueue.shift();
      if (!nextItem) {
        return;
      }

      if (this.loadingQueue.has(nextItem.url)) {
        continue;
      }

      this.activePreloads++;
      this.loadVideo(nextItem.url, nextItem.priority, nextItem.mode)
        .catch((error) => {
          console.warn('Video preload failed:', nextItem.url, error);
        })
        .finally(() => {
          this.activePreloads = Math.max(0, this.activePreloads - 1);
          this.processPendingQueue();
        });
    }
  }

  private async loadVideo(url: string, priority: number, mode: VideoLoadMode): Promise<string | null> {
    if (this.loadingQueue.has(url)) {
      const cached = this.cache.get(url);
      if (cached?.loadPromise) {
        await cached.loadPromise;
        return cached.objectUrl || null;
      }
    }

    const existing = this.cache.get(url);
    if (existing?.status === 'loaded' && existing.objectUrl) {
      existing.lastAccessed = Date.now();
      existing.priority = Math.max(existing.priority, priority);
      return existing.objectUrl;
    }

    if (existing?.status === 'error') {
      this.removeFromCache(url, existing);
    }

    this.loadingQueue.add(url);

    const cacheEntry: VideoCache = {
      ...(this.cache.get(url) || {}),
      url,
      status: 'loading',
      progress: 0,
      lastAccessed: Date.now(),
      priority,
    };

    this.cache.set(url, cacheEntry);
    this.notifyProgress(url, { url, loaded: 0, total: 0, progress: 0, status: 'loading' });

    cacheEntry.loadPromise = this.performLoad(url, cacheEntry, mode);

    try {
      await cacheEntry.loadPromise;
      return cacheEntry.objectUrl || null;
    } catch (error) {
      console.error('Failed to load video:', url, error);
      return null;
    } finally {
      this.loadingQueue.delete(url);
    }
  }

  private async performLoad(url: string, cacheEntry: VideoCache, mode: VideoLoadMode): Promise<void> {
    try {
      const candidates = getTimelineVideoSourceCandidates(url);
      let response: Response | null = null;
      let lastError: Error | null = null;
      const recentlyFailedProxy =
        mode === 'timeline' &&
        (Date.now() - (this.lastProxyFailureAt.get(url) || 0) < 15000);

      if (mode === 'timeline' && shouldUseTimelineVideoProxy(url) && !recentlyFailedProxy) {
        const [primaryUrl, ...fallbackUrls] = candidates;
        const request = buildTimelineVideoProxyRequest(primaryUrl, fallbackUrls);
        try {
          response = await fetch(request.input, request.init);
          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
            this.lastProxyFailureAt.set(url, Date.now());
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          this.lastProxyFailureAt.set(url, Date.now());
        }

        if (!response?.ok) {
          for (const candidate of candidates) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 8000);
              const candidateResponse = await fetch(candidate, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (candidateResponse.ok) {
                response = candidateResponse;
                break;
              }
              lastError = new Error(`HTTP ${candidateResponse.status}: ${candidateResponse.statusText}`);
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
            }
          }
        }
      } else {
        for (const candidate of candidates) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const candidateResponse = await fetch(candidate, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (candidateResponse.ok) {
              response = candidateResponse;
              break;
            }
            lastError = new Error(`HTTP ${candidateResponse.status}: ${candidateResponse.statusText}`);
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
          }
        }
      }

      if (!response?.ok) {
        throw lastError || new Error('Video fetch failed');
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];

      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        chunks.push(value);
        loaded += value.length;

        const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
        cacheEntry.progress = progress;
        this.notifyProgress(url, { url, loaded, total, progress, status: 'loading' });
      }

      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' });
      const objectUrl = URL.createObjectURL(blob);

      cacheEntry.blob = blob;
      cacheEntry.objectUrl = objectUrl;
      cacheEntry.status = 'loaded';
      cacheEntry.progress = 100;

      this.currentCacheSizeMB += blob.size / (1024 * 1024);
      this.enforceCacheLimits();

      this.notifyProgress(url, { url, loaded, total, progress: 100, status: 'loaded' });
    } catch (error) {
      cacheEntry.status = 'error';
      cacheEntry.progress = 0;
      this.notifyProgress(url, { url, loaded: 0, total: 0, progress: 0, status: 'error' });
      console.error('Video load error:', error);
      throw error;
    }
  }

  private notifyProgress(url: string, progress: VideoLoadProgress): void {
    const callbacks = this.progressCallbacks.get(url);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(progress);
        } catch (error) {
          console.error('Progress callback error:', error);
        }
      });
    }
  }

  private enforceCacheLimits(): void {
    const entries = Array.from(this.cache.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    while (this.cache.size > this.maxCacheSize && entries.length > 0) {
      const [url, cached] = entries.shift()!;
      this.removeFromCache(url, cached);
    }

    while (this.currentCacheSizeMB > this.maxCacheSizeMB && entries.length > 0) {
      const [url, cached] = entries.shift()!;
      this.removeFromCache(url, cached);
    }
  }

  private removeFromCache(url: string, cached: VideoCache): void {
    if (cached.objectUrl) {
      URL.revokeObjectURL(cached.objectUrl);
    }

    if (cached.blob) {
      this.currentCacheSizeMB = Math.max(0, this.currentCacheSizeMB - (cached.blob.size / (1024 * 1024)));
    }

    this.cache.delete(url);
  }
}

export const videoCacheManager = new VideoCacheManager();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    videoCacheManager.clearCache();
  });
}
