"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Download, Expand, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimelineData, TimelineAsset } from '@/lib/nolanx/types/timeline';
import { videoCacheManager } from '@/lib/nolanx/utils/videoCacheManager';
import { videoPerformanceMonitor } from '@/lib/nolanx/utils/videoPerformanceMonitor';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';
import { getTimelineVideoSourceCandidates } from '@/lib/utils/videoUrl';
import { toast } from 'sonner';
import { eventBus } from '@/lib/nolanx/utils/event';


interface PreviewPlayerProps {
  canvasId?: string;
  timelineData: TimelineData;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
}

function canUseBrowserFfmpeg(pathname: string | null) {
  if (!pathname) return false;
  return pathname === '/canvas' || pathname.startsWith('/canvas/') || /^\/[a-z]{2}(?:-[A-Z]{2})?\/canvas(?:\/|$)/.test(pathname);
}

function getStoryboardClipIndex(asset: TimelineAsset): number | null {
  const clipIndex = asset.metadata?.storyboard?.scriptClipIndex ?? asset.metadata?.storyboard?.clipIndex;
  return typeof clipIndex === 'number' && Number.isFinite(clipIndex) ? clipIndex : null;
}

function getScriptClipIndex(asset: TimelineAsset): number | null {
  const clipIndex = asset.metadata?.storyboard?.scriptClipIndex ?? asset.metadata?.clipIndex;
  return typeof clipIndex === 'number' && Number.isFinite(clipIndex) ? clipIndex : null;
}

function getAssetTimestamp(asset: TimelineAsset): number {
  const raw = asset.updated_at || asset.created_at || '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getExportOrderedVideoAssets(timelineData: TimelineData): TimelineAsset[] {
  const scriptTrack = timelineData.tracks.find((track) => track.type === 'script');
  const videoTrack = timelineData.tracks.find((track) => track.type === 'video');
  const scriptAssets = (scriptTrack?.assets || [])
    .filter((asset) => asset.duration > 0)
    .sort((a, b) => a.startTime - b.startTime);
  const candidateVideoAssets = (videoTrack?.assets || [])
    .filter((asset) => asset.content.videoUrl && asset.duration > 0);

  const bestVideoByClipIndex = new Map<number, TimelineAsset>();
  const fallbackVideoAssets: TimelineAsset[] = [];

  candidateVideoAssets.forEach((asset) => {
    const clipIndex = getStoryboardClipIndex(asset);
    if (clipIndex == null) {
      fallbackVideoAssets.push(asset);
      return;
    }

    const existing = bestVideoByClipIndex.get(clipIndex);
    if (!existing) {
      bestVideoByClipIndex.set(clipIndex, asset);
      return;
    }

    const existingTs = getAssetTimestamp(existing);
    const candidateTs = getAssetTimestamp(asset);
    if (candidateTs >= existingTs) {
      bestVideoByClipIndex.set(clipIndex, asset);
    }
  });

  const ordered: TimelineAsset[] = [];
  const usedAssetIds = new Set<string>();
  const scriptClipIndexes = scriptAssets.map((asset, index) => {
    const storyboardClipIndex = getScriptClipIndex(asset) ?? getStoryboardClipIndex(asset);
    const metadataClipIndex = typeof asset.metadata?.clipIndex === 'number' ? asset.metadata.clipIndex : null;
    return metadataClipIndex ?? storyboardClipIndex ?? (index + 1);
  });

  scriptClipIndexes.forEach((clipIndex) => {
    const matchedVideo = clipIndex != null ? bestVideoByClipIndex.get(clipIndex) : undefined;
    if (matchedVideo && !usedAssetIds.has(matchedVideo.id)) {
      ordered.push(matchedVideo);
      usedAssetIds.add(matchedVideo.id);
    }
  });

  const remainingVideos = candidateVideoAssets
    .filter((asset) => !usedAssetIds.has(asset.id))
    .sort((a, b) => {
      const clipA = getStoryboardClipIndex(a) ?? Number.MAX_SAFE_INTEGER;
      const clipB = getStoryboardClipIndex(b) ?? Number.MAX_SAFE_INTEGER;
      if (clipA !== clipB) return clipA - clipB;
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
      return getAssetTimestamp(a) - getAssetTimestamp(b);
    });

  ordered.push(...remainingVideos);
  return ordered;
}

function buildScriptVideoAlignmentReport(timelineData: TimelineData) {
  const scriptTrack = timelineData.tracks.find((track) => track.type === 'script');
  const videoTrack = timelineData.tracks.find((track) => track.type === 'video');
  const scriptAssets = (scriptTrack?.assets || [])
    .filter((asset) => asset.duration > 0)
    .sort((a, b) => a.startTime - b.startTime);
  const videoAssets = (videoTrack?.assets || [])
    .filter((asset) => asset.content.videoUrl && asset.duration > 0);
  const videoByClip = new Set(
    videoAssets
      .map((asset) => getStoryboardClipIndex(asset))
      .filter((clipIndex): clipIndex is number => typeof clipIndex === 'number')
  );
  const scriptClipIndexes = scriptAssets.map((asset, index) => {
    const metadataClipIndex = typeof asset.metadata?.clipIndex === 'number' ? asset.metadata.clipIndex : null;
    return metadataClipIndex ?? getScriptClipIndex(asset) ?? getStoryboardClipIndex(asset) ?? (index + 1);
  });
  return {
    scriptCount: scriptClipIndexes.length,
    videoCount: videoAssets.length,
    alignedCount: scriptClipIndexes.filter((clipIndex) => videoByClip.has(clipIndex)).length,
  };
}

export function PreviewPlayer({
  canvasId,
  timelineData,
  currentTime,
  isPlaying,
  onSeek,
  onPlay,
  onPause,
}: PreviewPlayerProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const [currentVideoAsset, setCurrentVideoAsset] = useState<TimelineAsset | null>(null);
  const [currentImageAsset, setCurrentImageAsset] = useState<TimelineAsset | null>(null);
  const [currentAudioAsset, setCurrentAudioAsset] = useState<TimelineAsset | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isFullscreenExporting, setIsFullscreenExporting] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [fullscreenVideoUrl, setFullscreenVideoUrl] = useState<string | null>(null);
  const fullscreenOverlayRef = useRef<HTMLDivElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);

  const resolveVideoSource = useCallback(async (videoUrl: string) => {
    const cachedUrl = await videoCacheManager.getVideo(videoUrl, 10, 'timeline');
    const candidates = getTimelineVideoSourceCandidates(videoUrl);
    return cachedUrl || candidates[candidates.length - 1];
  }, []);

  const exportTimelineVideo = useCallback(async () => {
    if (isExporting || isFullscreenExporting) return null;

    if (!canUseBrowserFfmpeg(pathname)) {
      toast.error(t('canvas:preview.exportFailed', { defaultValue: 'Export is only available in Canvas.' }));
      return null;
    }

    console.log('🎬 Starting direct export...');
    setIsExporting(true);

    try {
      // 1. Export by script-track order, then match the unique video asset for each clipIndex.
      const videoAssets = getExportOrderedVideoAssets(timelineData);
      const alignment = buildScriptVideoAlignmentReport(timelineData);

      if (videoAssets.length === 0) {
        throw new Error('No video assets found to export');
      }

      console.log('🎯 Script/video alignment:', alignment);

      console.log('Exporting video track assets:', videoAssets.map((asset, index) => ({
        index,
        id: asset.id,
        clipIndex: getStoryboardClipIndex(asset),
        startTime: asset.startTime,
        duration: asset.duration,
        videoUrl: asset.content.videoUrl,
      })));

      // 2. 动态导入FFmpeg
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');

      const ffmpeg = new FFmpeg();
      await ffmpeg.load();

      // 3. 下载所有视频文件
      const videoFiles: string[] = [];
      for (let i = 0; i < videoAssets.length; i++) {
        const asset = videoAssets[i];
        const filename = `video_${i}.mp4`;
        const sourceUrl = await resolveVideoSource(asset.content.videoUrl!);
        const data = await fetchFile(sourceUrl);
        await ffmpeg.writeFile(filename, data);
        videoFiles.push(filename);
      }

      // 4. Concatenate only the video track files in timeline order.
      let videoCommand: string[] = [];
      if (videoFiles.length === 1) {
        videoCommand = ['-i', videoFiles[0]];
      } else {
        const concatList = videoFiles.map(file => `file '${file}'`).join('\n');
        await ffmpeg.writeFile('video_list.txt', concatList);
        videoCommand = ['-f', 'concat', '-safe', '0', '-i', 'video_list.txt'];
      }

      const finalCommand = [
        ...videoCommand,
        '-c:v', 'copy',
        'output.mp4'
      ];

      console.log('FFmpeg command:', finalCommand);
      await ffmpeg.exec(finalCommand);

      // 8. 读取输出文件并下载
      const data = await ffmpeg.readFile('output.mp4');
      const videoBlob = new Blob([data], { type: 'video/mp4' });

      console.log('✅ Export completed successfully');
      toast.success(t('canvas:preview.exportSuccess', { defaultValue: 'Export completed.' }));
      setIsExporting(false);
      return videoBlob;

    } catch (error) {
      console.error('Export failed:', error);
      toast.error(t('canvas:preview.exportFailed', { defaultValue: 'Export failed.' }));
      setIsExporting(false);
      return null;
    }
  }, [timelineData, isExporting, isFullscreenExporting, resolveVideoSource, t, pathname]);

  const handleDirectExport = useCallback(async () => {
    const videoBlob = await exportTimelineVideo();
    if (!videoBlob) return;

    const url = URL.createObjectURL(videoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeline-export-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [exportTimelineVideo]);

  const handleFullscreenPlayback = useCallback(async () => {
    if (isFullscreenExporting || isExporting) return;
    setIsFullscreenExporting(true);
    try {
      const videoBlob = await exportTimelineVideo();
      if (!videoBlob) return;
      const url = URL.createObjectURL(videoBlob);
      setFullscreenVideoUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
    } finally {
      setIsFullscreenExporting(false);
    }
  }, [exportTimelineVideo, isExporting, isFullscreenExporting]);

  const closeFullscreenPlayback = useCallback(() => {
    setFullscreenVideoUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!canvasId) return;
    const handleExportFullscreen = (data: { canvasId: string }) => {
      if (data.canvasId !== canvasId) return;
      void handleFullscreenPlayback();
    };
    eventBus.on('Canvas::Preview::ExportFullscreen', handleExportFullscreen);
    return () => {
      eventBus.off('Canvas::Preview::ExportFullscreen', handleExportFullscreen);
    };
  }, [canvasId, handleFullscreenPlayback]);

  useEffect(() => {
    if (!fullscreenVideoUrl) return;
    const overlay = fullscreenOverlayRef.current;
    if (!overlay) return;
    overlay.requestFullscreen?.().catch(() => {});
    const video = fullscreenVideoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }, [fullscreenVideoUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && fullscreenVideoUrl) {
        closeFullscreenPlayback();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [fullscreenVideoUrl, closeFullscreenPlayback]);

  useEffect(() => {
    return () => {
      if (fullscreenVideoUrl) {
        URL.revokeObjectURL(fullscreenVideoUrl);
      }
    };
  }, [fullscreenVideoUrl]);

  // 智能预加载视频
  useEffect(() => {
    const videoTrack = timelineData.tracks.find(t => t.type === 'video');
    if (!videoTrack?.assets.length) return;

    // 按时间顺序排序视频资产
    const sortedVideos = [...videoTrack.assets].sort((a, b) => a.startTime - b.startTime);

    // 找到当前播放位置附近的视频
    const currentIndex = sortedVideos.findIndex(asset =>
      currentTime >= asset.startTime && currentTime < asset.startTime + asset.duration
    );

    // 预加载策略：当前视频 + 前后各2个视频
    const preloadUrls: Array<{ url: string; priority: number }> = [];

    for (let i = Math.max(0, currentIndex - 2); i <= Math.min(sortedVideos.length - 1, currentIndex + 2); i++) {
      const asset = sortedVideos[i];
      if (asset?.content.videoUrl) {
        // 当前视频最高优先级，距离越近优先级越高
        const distance = Math.abs(i - currentIndex);
        const priority = distance === 0 ? 10 : Math.max(1, 8 - distance);
        preloadUrls.push({ url: asset.content.videoUrl, priority });
      }
    }

    // 批量预加载
    if (preloadUrls.length > 0) {
      videoCacheManager.preloadVideos(preloadUrls.map((item) => ({
        ...item,
        mode: 'timeline' as const,
      })));
    }
  }, [currentTime, timelineData.tracks]);

  // 检测当前时间的资产
  useEffect(() => {
    const videoTrack = timelineData.tracks.find(t => t.type === 'video');
    const keyframeTrack = timelineData.tracks.find(t => t.type === 'keyframe');
    const audioTrack = timelineData.tracks.find(t => t.type === 'audio');

    // 找到当前时间的视频资产
    const currentVideo = videoTrack?.assets.find(asset =>
      currentTime >= asset.startTime &&
      currentTime < asset.startTime + asset.duration
    );
    setCurrentVideoAsset(currentVideo || null);

    // 找到当前时间的图片资产（如果没有视频）
    if (!currentVideo) {
      const currentImage = keyframeTrack?.assets.find(asset =>
        currentTime >= asset.startTime &&
        currentTime < asset.startTime + asset.duration
      );
      setCurrentImageAsset(currentImage || null);
    } else {
      setCurrentImageAsset(null);
    }

    // 找到当前时间的音频资产
    const currentAudio = audioTrack?.assets.find(asset =>
      currentTime >= asset.startTime &&
      currentTime < asset.startTime + asset.duration
    );
    setCurrentAudioAsset(currentAudio || null);
  }, [currentTime, timelineData.tracks]);

  // 自动启用音频的处理
  const enableAudio = useCallback(async () => {
    try {
      // 创建一个静音的音频上下文来启用音频
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
    } catch (error) {
      console.warn('Failed to enable audio:', error);
    }
  }, []);

  // 优化的视频播放器控制
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideoAsset) return;

    const videoUrl = currentVideoAsset.content.videoUrl;
    if (!videoUrl) return;

    // 开始性能监控
    const stopMonitoring = videoPerformanceMonitor.startMonitoring(video, videoUrl);

    // 使用缓存管理器获取视频
    const loadVideo = async () => {
      try {
        const cachedUrl = await resolveVideoSource(videoUrl);

        if (cachedUrl && video.src !== cachedUrl) {
          video.src = cachedUrl;
          video.load();

          // 等待视频元数据加载完成
          await new Promise<void>((resolve) => {
            const onLoadedMetadata = () => {
              video.removeEventListener('loadedmetadata', onLoadedMetadata);
              resolve();
            };

            if (video.readyState >= 1) {
              resolve();
            } else {
              video.addEventListener('loadedmetadata', onLoadedMetadata);
            }
          });
        }
      } catch (error) {
        console.warn('Failed to load video from cache:', error);
        // 降级到直接设置URL
        const fallbackCandidates = getTimelineVideoSourceCandidates(videoUrl);
        const directUrl = fallbackCandidates[fallbackCandidates.length - 1] || videoUrl;
        if (video.src !== directUrl) {
          video.src = directUrl;
          video.load();
        }
      }
    };

    loadVideo();

    // 清理函数
    return () => {
      stopMonitoring();
    };
  }, [currentVideoAsset, resolveVideoSource]);

  // 分离的播放控制逻辑
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideoAsset) return;

    // 设置音量和静音状态
    video.volume = isMuted ? 0 : volume;
    video.muted = isMuted;

    // 计算相对时间
    const relativeTime = currentTime - currentVideoAsset.startTime;
    const assetEndTime = currentVideoAsset.startTime + currentVideoAsset.duration;

    // 检查是否在播放范围内
    if (currentTime >= currentVideoAsset.startTime && currentTime < assetEndTime) {
      // 同步视频时间（减少频繁调整）
      if (Math.abs(video.currentTime - relativeTime) > 0.3) {
        video.currentTime = Math.max(0, relativeTime);
      }

      // 控制播放/暂停
      if (isPlaying && video.paused && video.readyState >= 3) {
        // 启用音频（如果还没启用）
        enableAudio();
        video.play().catch(console.warn);
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
    } else {
      // 不在范围内，暂停
      if (!video.paused) {
        video.pause();
      }
    }
  }, [currentTime, isPlaying, currentVideoAsset, volume, isMuted, enableAudio]);

  // 原生音频播放器控制
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentAudioAsset) return;

    // 设置音频源
    if (audio.src !== currentAudioAsset.content.audioUrl) {
      audio.src = currentAudioAsset.content.audioUrl || '';
      audio.load();
    }

    // 设置音量和静音状态
    audio.volume = isMuted ? 0 : volume;
    audio.muted = isMuted;

    // 计算相对时间
    const relativeTime = currentTime - currentAudioAsset.startTime;
    const assetEndTime = currentAudioAsset.startTime + currentAudioAsset.duration;

    // 检查是否在播放范围内
    if (currentTime >= currentAudioAsset.startTime && currentTime < assetEndTime) {
      // 同步音频时间
      if (Math.abs(audio.currentTime - relativeTime) > 0.2) {
        audio.currentTime = Math.max(0, relativeTime);
      }

      // 控制播放/暂停
      if (isPlaying && audio.paused) {
        // 启用音频（如果还没启用）
        enableAudio();
        audio.play().catch(console.warn);
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    } else {
      // 不在范围内，暂停
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [currentTime, isPlaying, currentAudioAsset, volume, isMuted, enableAudio]);

  // 简化：删除所有Canvas渲染逻辑，使用原生元素



  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Preview Area */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div
          ref={previewContainerRef}
          className="group relative w-full h-full max-w-full max-h-full aspect-video rounded-xl overflow-hidden shadow-2xl border border-black/20 dark:border-white/10 bg-black"
        >

          {/* 原生视频播放器 */}
          {currentVideoAsset && (
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              playsInline
              preload="metadata"
              onError={() => {
                if (!videoRef.current || !currentVideoAsset?.content.videoUrl) return;

                const fallbackCandidates = getTimelineVideoSourceCandidates(currentVideoAsset.content.videoUrl);
                const directFallbackUrl = fallbackCandidates[1];
                if (!directFallbackUrl || videoRef.current.src === directFallbackUrl) {
                  return;
                }

                console.warn('Timeline video primary URL failed, retrying with provider fallback:', {
                  primary: currentVideoAsset.content.videoUrl,
                  fallback: directFallbackUrl,
                });
                videoRef.current.src = directFallbackUrl;
                videoRef.current.load();
              }}
            />
          )}

          {/* 图片显示 */}
          {!currentVideoAsset && currentImageAsset && (
            <img
              src={currentImageAsset.content.imageUrl}
              alt={currentImageAsset.content.title || 'Preview'}
              className="w-full h-full object-contain"
            />
          )}

          {/* 原生音频播放器（隐藏） */}
          <audio
            ref={audioRef}
            className="hidden"
            preload="metadata"
          />

          {/* 占位符 */}
          {!currentVideoAsset && !currentImageAsset && (
            <div className="flex items-center justify-center w-full h-full text-white/50">
              <div className="text-center">
                <div className="text-4xl mb-4">🎬</div>
                <div className="text-lg font-medium">{t('canvas:preview.placeholder.title')}</div>
                <div className="text-sm">{t('canvas:preview.placeholder.hint')}</div>
              </div>
            </div>
          )}



          {/* Controls overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Audio controls - bottom left */}
            <div className="absolute bottom-2 left-2 pointer-events-auto flex items-center gap-2 group">
              <Button
                onClick={() => setIsMuted(!isMuted)}
                size="sm"
                variant="outline"
                className="bg-white/90 dark:bg-black/90 backdrop-blur-sm border border-black/20 dark:border-white/20 hover:bg-white dark:hover:bg-black shadow-lg"
                title={isMuted ? t('canvas:preview.unmute') : t('canvas:preview.mute')}
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </Button>

              {/* Volume slider - only show on hover */}
              {!isMuted && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-2 bg-white/90 dark:bg-black/90 backdrop-blur-sm border border-black/20 dark:border-white/20 rounded-md px-2 py-1 shadow-lg">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    title={t('canvas:preview.volume', { percent: Math.round(volume * 100) })}
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[2rem]">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
              )}
            </div>

            {/* Export button - top right */}
            <div className="absolute top-2 right-2 pointer-events-auto flex items-center gap-2">
              <div className="translate-x-3 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
                <Button
                  onClick={handleFullscreenPlayback}
                  disabled={isFullscreenExporting || isExporting}
                  size="sm"
                  className="bg-white/92 text-black hover:bg-white dark:bg-black/92 dark:text-white dark:hover:bg-black border border-black/10 dark:border-white/12 shadow-lg"
                  title="Export and play fullscreen"
                >
                  {isFullscreenExporting ? (
                    <div className="w-4 h-4 mr-1 animate-spin">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="60">
                          <animate attributeName="stroke-dashoffset" values="60;0;60" dur="2s" repeatCount="indefinite"/>
                        </circle>
                      </svg>
                    </div>
                  ) : (
                    <Expand className="w-4 h-4 mr-1" />
                  )}
                  <Play className="w-3.5 h-3.5 mr-1" />
                  Full Screen
                </Button>
              </div>
              <Button
                onClick={handleDirectExport}
                disabled={isExporting || isFullscreenExporting}
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white shadow-lg"
              >
                {isExporting ? (
                  <div className="w-4 h-4 mr-1 animate-spin">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="60">
                        <animate attributeName="stroke-dashoffset" values="60;0;60" dur="2s" repeatCount="indefinite"/>
                      </circle>
                      <path d="M12 6v6l4 2"/>
                    </svg>
                  </div>
                ) : (
                  <Download className="w-4 h-4 mr-1" />
                )}
                {isExporting ? t('canvas:preview.exporting') : t('canvas:preview.export')}
              </Button>
            </div>

            {/* 当前资产信息 */}
            {(currentVideoAsset || currentImageAsset || currentAudioAsset) && (
              <div className="absolute top-2 left-2 bg-white/90 dark:bg-black/90 backdrop-blur-xl border border-black/30 dark:border-white/20 px-3 py-1 rounded-lg shadow-lg">
                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                  {currentVideoAsset?.content.title ||
                   currentImageAsset?.content.title ||
                   currentAudioAsset?.content.title ||
                   'Playing'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {fullscreenVideoUrl && (
        <div
          ref={fullscreenOverlayRef}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black"
        >
          <button
            type="button"
            onClick={closeFullscreenPlayback}
            className="absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-black/60 p-2 text-white backdrop-blur"
            title="Close fullscreen playback"
          >
            <X className="h-5 w-5" />
          </button>
          <video
            ref={fullscreenVideoRef}
            src={fullscreenVideoUrl}
            className="h-full w-full object-contain bg-black"
            controls
            autoPlay
            playsInline
          />
        </div>
      )}
    </div>
  );
}
