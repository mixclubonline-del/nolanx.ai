"use client";

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { TimelineAsset, TimelineTrack, TimelineConfig } from '@/lib/nolanx/types/timeline';
import { FileText, Image, Video, Volume2, Download, CheckCircle, Layers, Loader2, Sparkles, Wand2, MoreHorizontal, AlertTriangle, ShieldCheck, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { videoCacheManager, VideoLoadProgress } from '@/lib/nolanx/utils/videoCacheManager';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/nolanx/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/nolanx/ui/tooltip';
import { Button } from '@/components/nolanx/ui/button';
import { Textarea } from '@/components/nolanx/ui/textarea';
import { regenerateTimelineAsset } from '@/lib/nolanx/api/canvas';
import { toast } from 'sonner';

const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|m3u8)(?:$|[?#])/i;

const readContentUrl = (content: TimelineAsset['content'], ...keys: string[]): string => {
  const source = (content || {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const looksLikeVideoUrl = (value?: string): boolean => {
  if (!value) return false;
  return VIDEO_URL_RE.test(value) || value.includes('.mp4?') || value.includes('mime_type=video') || value.includes('/video/');
};

interface AssetItemProps {
  canvasId: string;
  asset: TimelineAsset;
  track: TimelineTrack;
  index: number;
  isSelected: boolean;
  config: TimelineConfig;
  laneMode?: 'collapsed' | 'expanded';
  onSelect: (assetId: string) => void;
  onPatchAsset: (asset: TimelineAsset) => void;
}

export function AssetItem({
  canvasId,
  asset,
  track,
  index,
  isSelected,
  config,
  laneMode,
  onSelect,
  onPatchAsset,
}: AssetItemProps) {
  const { t } = useTranslation();
  const width = asset.duration * config.pixelsPerSecond;
  const left = asset.startTime * config.pixelsPerSecond;
  const isScriptBibleElement =
    asset.type === 'script' &&
    (Boolean(asset.metadata?.bibleElement) || String(asset.metadata?.kind || '').toLowerCase().includes('bible'));
  const isWorldCollapsed = asset.type === 'world' && laneMode === 'collapsed';
  const isScriptCollapsed = asset.type === 'script' && laneMode === 'collapsed';
  const isCollapsedCompact = isWorldCollapsed || isScriptCollapsed;
  const supportsPointRegenerate = asset.type === 'video' || asset.type === 'keyframe' || asset.type === 'world';
  const [resolvedPreviewVideoUrl, setResolvedPreviewVideoUrl] = useState<string>('');
  const [firstFramePosterUrl, setFirstFramePosterUrl] = useState<string>('');
  const contentVideoUrl = useMemo(() => {
    const directVideoUrl = readContentUrl(asset.content, 'videoUrl', 'video_url', 'resourceUrl');
    if (directVideoUrl) {
      return directVideoUrl;
    }
    if (typeof asset.metadata?.resourceUrl === 'string' && asset.metadata.resourceUrl.trim()) {
      return asset.metadata.resourceUrl.trim();
    }
    const thumbnailCandidate = readContentUrl(asset.content, 'thumbnailUrl', 'thumbnail_url');
    if (looksLikeVideoUrl(thumbnailCandidate)) {
      return thumbnailCandidate;
    }
    const imageCandidate = readContentUrl(asset.content, 'imageUrl', 'image_url');
    if (looksLikeVideoUrl(imageCandidate)) {
      return imageCandidate;
    }
    return '';
  }, [asset.content, asset.metadata]);
  const contentPosterUrl = useMemo(() => {
    const posterCandidate = readContentUrl(asset.content, 'posterUrl', 'poster_url', 'thumbnailUrl', 'thumbnail_url', 'imageUrl', 'image_url');
    if (posterCandidate && !looksLikeVideoUrl(posterCandidate)) {
      return posterCandidate;
    }
    if (typeof asset.metadata?.thumbnailUrl === 'string' && asset.metadata.thumbnailUrl.trim()) {
      return asset.metadata.thumbnailUrl.trim();
    }
    if (typeof asset.metadata?.imageUrl === 'string' && asset.metadata.imageUrl.trim()) {
      return asset.metadata.imageUrl.trim();
    }
    return '';
  }, [asset.content, asset.metadata]);
  const worldCoverImageUrl = useMemo(() => {
    if (asset.type !== 'world') return '';
    const contentImage = readContentUrl(asset.content, 'imageUrl', 'image_url');
    if (contentImage && !looksLikeVideoUrl(contentImage)) return contentImage;
    const metaImage = typeof asset.metadata?.imageUrl === 'string' ? asset.metadata.imageUrl.trim() : '';
    if (metaImage && !looksLikeVideoUrl(metaImage)) return metaImage;
    const poster = readContentUrl(asset.content, 'posterUrl', 'poster_url', 'thumbnailUrl', 'thumbnail_url');
    if (poster && !looksLikeVideoUrl(poster)) return poster;
    return '';
  }, [asset.content, asset.metadata, asset.type]);

  // 视频下载进度状态
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'pending' | 'loading' | 'loaded' | 'error'>('idle');
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [modifyMode, setModifyMode] = useState(false);
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const review = asset.metadata?.review;
  const reviewStatus = String(review?.status || '').trim();
  const reviewScore = Number(review?.score || 0);
  const reviewChecks = (review?.assetReview?.checks || review?.promptReview?.checks || []).slice(0, 3);
  const reviewToneClass = reviewStatus === 'approved_auto'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : reviewStatus === 'attention_needed'
      ? 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200';

  // 监听视频下载进度与可用预览源（对任何带视频URL的资产）
  useEffect(() => {
    if (!contentVideoUrl) {
      setResolvedPreviewVideoUrl('');
      setFirstFramePosterUrl('');
      setDownloadStatus('idle');
      setDownloadProgress(0);
      return;
    }

    const videoUrl = contentVideoUrl;
    const syncStatus = () => {
      const currentStatus = videoCacheManager.getVideoStatus(videoUrl);
      if (!currentStatus) {
        setDownloadStatus('idle');
        setDownloadProgress(0);
        return;
      }

      setDownloadStatus(currentStatus.status);
      setDownloadProgress(currentStatus.progress);
      if (currentStatus.objectUrl) {
        setResolvedPreviewVideoUrl(currentStatus.objectUrl);
      }
    };

    syncStatus();

    const unsubscribe = videoCacheManager.onProgress(videoUrl, (progress: VideoLoadProgress) => {
      if (progress.status) {
        setDownloadStatus(progress.status);
      }

      setDownloadProgress(progress.progress);
      const currentStatus = videoCacheManager.getVideoStatus(videoUrl);
      if (currentStatus?.objectUrl) {
        setResolvedPreviewVideoUrl(currentStatus.objectUrl);
      }

      if (progress.status === 'error') {
        setDownloadStatus('error');
      } else if (progress.progress === 100) {
        setDownloadStatus('loaded');
      } else if (progress.progress > 0) {
        setDownloadStatus('loading');
      }
    });

    videoCacheManager.preloadVideo(videoUrl, 10, 'timeline');
    syncStatus();
    void videoCacheManager.getVideo(videoUrl, 10, 'timeline').then((cachedUrl) => {
      if (cachedUrl) {
        setResolvedPreviewVideoUrl(cachedUrl);
      }
    }).catch(() => {
      // Ignore here and allow direct URL fallback.
    });

    return unsubscribe;
  }, [contentVideoUrl]);

  useEffect(() => {
    if (asset.type !== 'video' || !contentVideoUrl) {
      setFirstFramePosterUrl('');
      return;
    }

    let cancelled = false;
    let objectUrlToRevoke = '';
    const sourceUrl = resolvedPreviewVideoUrl || contentVideoUrl;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };

    const captureFrame = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob || cancelled) return;
          if (objectUrlToRevoke) {
            URL.revokeObjectURL(objectUrlToRevoke);
          }
          objectUrlToRevoke = URL.createObjectURL(blob);
          setFirstFramePosterUrl(objectUrlToRevoke);
        }, 'image/jpeg', 0.86);
      } catch {
        // Cross-origin video sources may reject canvas extraction; fall back to native video preview.
      }
    };

    video.addEventListener('loadeddata', captureFrame, { once: true });
    video.addEventListener('loadedmetadata', () => {
      try {
        video.currentTime = 0.001;
      } catch {
        captureFrame();
      }
    }, { once: true });
    video.addEventListener('seeked', captureFrame, { once: true });
    video.src = sourceUrl;
    video.load();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [asset.type, contentVideoUrl, resolvedPreviewVideoUrl]);

  const getAssetIcon = () => {
    switch (asset.type) {
      case 'world':
        return <Layers className="w-4 h-4" />;
      case 'script':
        return <FileText className="w-4 h-4" />;
      case 'keyframe':
        return <Image className="w-4 h-4" />;
      case 'video':
        return <Video className="w-4 h-4" />;
      case 'audio':
        return <Volume2 className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getAssetColor = () => {
    switch (asset.type) {
      case 'world':
        return 'bg-orange-500/5 dark:bg-orange-400/10 border-orange-500/15 dark:border-orange-400/20 text-orange-700/80 dark:text-orange-200/80';
      case 'script':
        return 'bg-orange-500/10 dark:bg-orange-400/15 border-orange-500/20 dark:border-orange-400/25 text-orange-700/80 dark:text-orange-200/80';
      case 'keyframe':
        return 'bg-green-500/10 dark:bg-green-400/15 border-green-500/20 dark:border-green-400/25 text-green-600/70 dark:text-green-300/70';
      case 'video':
        return 'bg-purple-500/20 dark:bg-purple-400/30 border-purple-500/30 dark:border-purple-400/40 text-purple-800 dark:text-purple-200';
      case 'audio':
        return 'bg-orange-500/20 dark:bg-orange-400/30 border-orange-500/30 dark:border-orange-400/40 text-orange-800 dark:text-orange-200';
      default:
        return 'bg-gray-500/20 dark:bg-gray-400/30 border-gray-500/30 dark:border-gray-400/40 text-gray-800 dark:text-gray-200';
    }
  };

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(asset.id);
  }, [asset.id, onSelect]);

  const handleRegenerate = useCallback(async (customPrompt?: string) => {
    if (!supportsPointRegenerate) {
      toast.error(t('canvas:timeline.assetActions.unsupported', { defaultValue: 'This asset type does not support point-to-point regenerate yet.' }));
      return;
    }

    try {
      setRegenerating(true);
      const result = await regenerateTimelineAsset(canvasId, asset.id, {
        prompt: customPrompt?.trim() || undefined,
      });
      if (result?.asset) {
        onPatchAsset(result.asset as TimelineAsset);
        if ((result.asset as TimelineAsset).type === 'video' && result.asset.content?.videoUrl) {
          videoCacheManager.preloadVideo(result.asset.content.videoUrl, 10, 'timeline');
        }
      }
      toast.success(t('canvas:timeline.assetActions.success', { defaultValue: 'Asset regenerated.' }));
      setModifyDialogOpen(false);
      setModifyMode(false);
      setModifyPrompt('');
    } catch (error) {
      console.error('Failed to regenerate timeline asset:', error);
      const message =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        t('canvas:timeline.assetActions.failed', { defaultValue: 'Failed to regenerate asset.' });
      toast.error(String(message));
    } finally {
      setRegenerating(false);
    }
  }, [asset.id, canvasId, onPatchAsset, supportsPointRegenerate, t]);

  const getDisplayTitle = () => {
    const rawTitle = asset.content.title?.trim();
    if (!rawTitle) {
      return t(`canvas:timeline.indexedTitles.${asset.type}`, { index: index + 1 });
    }

    const patterns: Array<[RegExp, TimelineAsset["type"]]> = [
      [/^world\s*(\d+)$/i, "world"],
      [/^script\s*(\d+)$/i, "script"],
      [/^key\s*frame\s*(\d+)$/i, "keyframe"],
      [/^keyframe\s*(\d+)$/i, "keyframe"],
      [/^image\s*asset\s*(\d+)$/i, "keyframe"],
      [/^video\s*(\d+)$/i, "video"],
      [/^video\s*asset\s*(\d+)?$/i, "video"],
      [/^audio\s*(\d+)$/i, "audio"],
      [/^audio\s*asset\s*(\d+)?$/i, "audio"],
    ];

    for (const [regex, type] of patterns) {
      const match = rawTitle.match(regex);
      if (match) {
        const numeric = match[1] ? Number(match[1]) : index + 1;
        const safeIndex = Number.isFinite(numeric) && numeric > 0 ? numeric : index + 1;
        return t(`canvas:timeline.indexedTitles.${type}`, { index: safeIndex });
      }
    }

    return rawTitle;
  };

  const renderVideoPreview = ({
    videoUrl,
    posterUrl,
    alt,
    thumbClassName,
    previewClassName,
    title,
    subtitle,
    showStatusBadge = false,
  }: {
    videoUrl: string;
    posterUrl?: string;
    alt: string;
    thumbClassName: string;
    previewClassName: string;
    title: string;
    subtitle?: string;
    showStatusBadge?: boolean;
  }) => {
    if (!videoUrl) return null;

    const previewSrc = resolvedPreviewVideoUrl || videoUrl;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative flex-shrink-0">
            <video
              src={previewSrc}
              poster={posterUrl || undefined}
              muted
              playsInline
              preload="metadata"
              className={thumbClassName}
              onLoadedData={(e) => {
                if (!posterUrl && e.currentTarget.currentTime === 0) {
                  try {
                    e.currentTarget.currentTime = 0.01;
                  } catch {
                    // Ignore seek errors on metadata-only loads.
                  }
                }
              }}
            />
            {showStatusBadge && downloadStatus === 'loading' && (
              <div className="absolute inset-0 bg-black/50 rounded flex items-center justify-center">
                <Download className="w-3 h-3 text-white animate-pulse" />
              </div>
            )}
            {showStatusBadge && downloadStatus === 'loaded' && (
              <div className="absolute -top-1 -right-1">
                <CheckCircle className="w-3 h-3 text-green-500 bg-white rounded-full" />
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={10}
          className="p-2 bg-white/95 dark:bg-black/95 text-gray-900 dark:text-white border border-black/10 dark:border-white/15 shadow-xl"
        >
          <div className="w-56">
            <video
              src={previewSrc}
              poster={posterUrl || undefined}
              className={previewClassName}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
            />
            <div className="mt-2 text-[11px] font-semibold truncate">{title}</div>
            {subtitle ? (
              <div className="mt-0.5 text-[11px] text-gray-600 dark:text-white/70 line-clamp-2">
                {subtitle}
              </div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderWorldMediaPreview = ({
    imageUrl,
    videoUrl,
    posterUrl,
    title,
    subtitle,
    thumbClassName,
  }: {
    imageUrl?: string;
    videoUrl?: string;
    posterUrl?: string;
    title: string;
    subtitle?: string;
    thumbClassName: string;
  }) => {
    if (!imageUrl && !videoUrl) return null;

    const previewSrc = videoUrl ? (resolvedPreviewVideoUrl || videoUrl) : '';

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative flex-shrink-0">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={title}
                className={thumbClassName}
              />
            ) : videoUrl ? (
              <video
                src={previewSrc}
                poster={posterUrl || undefined}
                muted
                playsInline
                preload="metadata"
                className={thumbClassName}
              />
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={10}
          className="p-2 bg-white/95 dark:bg-black/95 text-gray-900 dark:text-white border border-black/10 dark:border-white/15 shadow-xl"
        >
          <div className={cn("grid gap-2", imageUrl && videoUrl ? "w-[28rem] grid-cols-2" : "w-56 grid-cols-1")}>
            {imageUrl ? (
              <div className="min-w-0">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-white/45">
                  Cover
                </div>
                <img
                  src={imageUrl}
                  alt={title}
                  className="h-36 w-full rounded-md border border-black/10 object-cover dark:border-white/15"
                />
              </div>
            ) : null}
            {videoUrl ? (
              <div className="min-w-0">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-white/45">
                  Audition
                </div>
                <video
                  src={previewSrc}
                  poster={posterUrl || imageUrl || undefined}
                  className="h-36 w-full rounded-md border border-black/10 object-cover dark:border-white/15"
                  muted
                  loop
                  autoPlay
                  playsInline
                  preload="metadata"
                />
              </div>
            ) : null}
            <div className={cn("min-w-0", imageUrl && videoUrl ? "col-span-2" : "")}>
              <div className="mt-1 truncate text-[11px] font-semibold">{title}</div>
              {subtitle ? (
                <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-600 dark:text-white/70">
                  {subtitle}
                </div>
              ) : null}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderAssetContent = () => {
    switch (asset.type) {
      case 'world': {
        const worldImageUrl = worldCoverImageUrl;
        const worldVideoUrl = contentVideoUrl;
        const worldKind = String(asset.metadata?.elementKind || asset.metadata?.kind || '').trim();
        const worldText = (asset.content.text || asset.content.description || '').trim();
        if (isWorldCollapsed) {
          if (!worldImageUrl && !worldVideoUrl) {
            return (
              <div className="flex items-center justify-center flex-1 min-w-0">
                <Layers className="w-4 h-4 opacity-70" />
              </div>
            );
          }

          return (
            <div className="flex items-center justify-center flex-1 min-w-0">
              {renderWorldMediaPreview({
                imageUrl: worldImageUrl,
                videoUrl: worldVideoUrl,
                posterUrl: contentPosterUrl,
                title: getDisplayTitle(),
                subtitle: worldText || worldKind || t('canvas:timeline.fallbackTitles.untitled'),
                thumbClassName: 'w-6 h-6 object-cover rounded border border-current/20',
              })}
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {renderWorldMediaPreview({
              imageUrl: worldImageUrl,
              videoUrl: worldVideoUrl,
              posterUrl: contentPosterUrl,
              title: getDisplayTitle(),
              subtitle: worldText || worldKind || t('canvas:timeline.fallbackTitles.untitled'),
              thumbClassName: 'w-8 h-8 object-cover rounded border border-current/20 flex-shrink-0',
            })}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{getDisplayTitle()}</div>
              <div className="text-[11px] opacity-75 line-clamp-2 break-words">
                {worldText || worldKind || t('canvas:timeline.fallbackTitles.untitled')}
              </div>
            </div>
          </div>
        );
      }
      case 'script': {
        const scriptImageUrl = asset.content.thumbnailUrl || asset.content.imageUrl;
        const scriptKind = String(asset.metadata?.elementKind || asset.metadata?.kind || '').trim();
        const scriptText = (asset.content.text || asset.content.description || '').trim();
        const scriptTooltipText = String(scriptText || scriptKind || t('canvas:timeline.fallbackTitles.untitled')).trim();
        const scriptPreviewText = scriptText || scriptKind || t('canvas:timeline.fallbackTitles.untitled');
        if (isScriptCollapsed) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center flex-1 min-w-0">
                  <div className="w-full min-w-0 text-center">
                    <div className="text-xs font-medium truncate text-center">{getDisplayTitle()}</div>
                  </div>
                </div>
              </TooltipTrigger>
              {scriptTooltipText ? (
                <TooltipContent
                  side="right"
                  sideOffset={10}
                  className="p-2 bg-white/95 dark:bg-black/95 text-gray-900 dark:text-white border border-black/10 dark:border-white/15 shadow-xl"
                >
                  <div className="w-72">
                    <div className="text-[11px] font-semibold truncate">{getDisplayTitle()}</div>
                    <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-600 dark:text-white/70">
                      {scriptTooltipText}
                    </div>
                  </div>
                </TooltipContent>
              ) : null}
            </Tooltip>
          );
        }

        const showDetailsInCard = laneMode === 'expanded';
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {scriptImageUrl ? (
                  <img
                    src={scriptImageUrl}
                    alt={getDisplayTitle()}
                    className="w-8 h-8 object-cover rounded border border-current/20 flex-shrink-0"
                  />
                ) : null}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{getDisplayTitle()}</div>
                  {showDetailsInCard ? (
                    <div className="text-[11px] opacity-75 line-clamp-2 break-words leading-snug">
                      {scriptPreviewText}
                    </div>
                  ) : null}
                </div>
              </div>
            </TooltipTrigger>
            {scriptTooltipText ? (
              <TooltipContent
                side="right"
                sideOffset={10}
                className="p-2 bg-white/95 dark:bg-black/95 text-gray-900 dark:text-white border border-black/10 dark:border-white/15 shadow-xl"
              >
                <div className="w-80">
                  <div className="text-[11px] font-semibold truncate">{getDisplayTitle()}</div>
                  <div className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-600 dark:text-white/70">
                    {scriptTooltipText}
                  </div>
                </div>
              </TooltipContent>
            ) : null}
          </Tooltip>
        );
      }
      
      case 'keyframe':
        return (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {asset.content.thumbnailUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <img
                    src={asset.content.thumbnailUrl}
                    alt={t('canvas:timeline.alts.keyframe')}
                    className="w-8 h-8 object-cover rounded border border-current/20"
                  />
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={10}
                  className="p-2 bg-white/95 dark:bg-black/95 text-gray-900 dark:text-white border border-black/10 dark:border-white/15 shadow-xl"
                >
                  <div className="w-56">
                    <img
                      src={asset.content.thumbnailUrl}
                      alt={t('canvas:timeline.alts.keyframe')}
                      className="w-full h-36 object-cover rounded-md border border-black/10 dark:border-white/15"
                    />
                    <div className="mt-2 text-[11px] font-semibold truncate">{getDisplayTitle()}</div>
                    <div className="mt-0.5 text-[11px] text-gray-600 dark:text-white/70">
                      {asset.content.width}x{asset.content.height}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {getDisplayTitle()}
              </div>
              <div className="text-xs opacity-75">
                {asset.content.width}x{asset.content.height}
              </div>
            </div>
          </div>
        );
      
      case 'video':
        return (
          <div className="flex items-center gap-2 flex-1 min-w-0 relative">
            {contentVideoUrl
              ? renderVideoPreview({
                  videoUrl: contentVideoUrl,
                  posterUrl: firstFramePosterUrl || contentPosterUrl,
                  alt: t('canvas:timeline.alts.videoThumbnail'),
                  thumbClassName: 'w-8 h-8 object-cover rounded border border-current/20',
                  previewClassName: 'w-full h-36 object-cover rounded-md border border-black/10 dark:border-white/15',
                  title: getDisplayTitle(),
                  subtitle: `${asset.duration.toFixed(1)}s • ${asset.content.aspectRatio || '16:9'}`,
                  showStatusBadge: true,
                })
              : contentPosterUrl ? (
                  <div className="relative">
                    <img
                      src={contentPosterUrl}
                      alt={t('canvas:timeline.alts.videoThumbnail')}
                      className="w-8 h-8 object-cover rounded border border-current/20"
                    />
                    {downloadStatus === 'loading' && (
                      <div className="absolute inset-0 bg-black/50 rounded flex items-center justify-center">
                        <Download className="w-3 h-3 text-white animate-pulse" />
                      </div>
                    )}
                    {downloadStatus === 'loaded' && (
                      <div className="absolute -top-1 -right-1">
                        <CheckCircle className="w-3 h-3 text-green-500 bg-white rounded-full" />
                      </div>
                    )}
                  </div>
                ) : null}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {getDisplayTitle()}
              </div>
              <div className="text-xs opacity-75 flex items-center gap-1">
                <span>{asset.duration.toFixed(1)}s • {asset.content.aspectRatio}</span>
                {downloadStatus === 'loading' && (
                  <span className="text-blue-500">
                    {downloadProgress}%
                  </span>
                )}
              </div>
            </div>

            {/* 下载进度条 */}
            {downloadStatus === 'loading' && downloadProgress > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            )}
          </div>
        );
      
      case 'audio':
        return (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Audio waveform visualization */}
            <div className="flex items-center gap-px h-6">
              {asset.content.waveformData?.slice(0, Math.floor(width / 4)).map((value, i) => (
                <div
                  key={i}
                  className="w-px bg-current opacity-60"
                  style={{ height: `${Math.max(2, value * 20)}px` }}
                />
              )) || (
                // Placeholder waveform
                Array.from({ length: Math.floor(width / 4) }).map((_, i) => (
                  <div
                    key={i}
                    className="w-px bg-current opacity-40"
                    style={{ height: `${Math.random() * 16 + 4}px` }}
                  />
                ))
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {getDisplayTitle()}
              </div>
              <div className="text-xs opacity-75">
                {asset.duration.toFixed(1)}s
              </div>
            </div>
          </div>
        );
      
      default:
        return (
          <div className="text-xs font-medium truncate">
            {getDisplayTitle()}
          </div>
        );
    }
  };

  // 判断是否为低优先级轨道
  const isLowPriority = asset.type === 'keyframe';

  return (
    <div
      className={cn(
        "timeline-asset group absolute rounded-lg cursor-pointer transition-all duration-200",
        "flex items-center overflow-hidden backdrop-blur-xl",
        isCollapsedCompact ? "gap-0 px-1.5 py-1" : "gap-3 px-3 py-2",
        isCollapsedCompact && "justify-center",
        "bg-white/80 dark:bg-black/80",
        getAssetColor(),
        isScriptBibleElement && "border-orange-500/40 dark:border-orange-400/40 text-orange-700/80 dark:text-orange-200/80",
        "hover:scale-[1.02] hover:z-10 hover:shadow-xl",
        "hover:border-orange-500/40 dark:hover:border-orange-400/40",
        isSelected && "ring-2 ring-orange-500/35 dark:ring-orange-400/35 border-orange-500/45 dark:border-orange-400/45 shadow-xl",
        // 低优先级轨道的特殊样式
        isLowPriority ? [
          "border-dashed border-2", // 虚线边框
          "shadow-sm", // 减弱阴影
          "opacity-75", // 降低整体透明度
        ] : [
          "border border-solid", // 实线边框
          "shadow-lg", // 正常阴影
        ]
      )}
      style={{
        left,
        width: Math.max(width, 80),
        height: '90%', // 占lane高度的90%
        top: '50%',
        transform: 'translateY(-50%)', // 垂直居中
        // 为低优先级轨道添加点状背景
        ...(isLowPriority && {
          backgroundImage: `radial-gradient(circle at 2px 2px, currentColor 0.5px, transparent 0.5px)`,
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0',
        }),
      }}
      data-asset-id={asset.id}
      onClick={handleClick}
      title={`${asset.type}: ${asset.content.title || t('canvas:timeline.fallbackTitles.untitled')} (${asset.duration.toFixed(1)}s) - ${t('canvas:timeline.actions.clickToSelect')}`}
    >
      {supportsPointRegenerate ? (
        <Popover
          open={modifyDialogOpen}
          onOpenChange={(open) => {
            setModifyDialogOpen(open);
            if (!open) {
              setModifyMode(false);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={(e) => e.stopPropagation()}
              disabled={regenerating}
              className="absolute right-2 top-2 z-20 h-7 w-7 rounded-md border border-black/8 bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 hover:bg-background dark:border-white/10"
            >
              {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[320px] border-orange-400/20 bg-white/78 p-0 shadow-2xl backdrop-blur-2xl dark:border-orange-300/15 dark:bg-black/68"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-orange-500/14 via-orange-400/8 to-transparent px-4 py-3">
              <div className="text-[13px] font-semibold text-foreground">
                {modifyMode
                  ? t('canvas:timeline.assetActions.title', { defaultValue: 'Modify This Asset' })
                  : t('canvas:timeline.actions.regenerate', { defaultValue: 'Regenerate' })}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {modifyMode
                  ? t('canvas:timeline.assetActions.description', { defaultValue: 'Describe the exact change for this clip or image. The system will keep the original shot intent and regenerate only this asset.' })
                  : t('canvas:timeline.assetActions.quickDescription', { defaultValue: 'Regenerate this single asset directly, or describe a targeted adjustment first.' })}
              </div>
            </div>

            {modifyMode ? (
              <>
                <div className="px-4 py-3">
                  <Textarea
                    value={modifyPrompt}
                    onChange={(e) => setModifyPrompt(e.target.value)}
                    placeholder={t('canvas:timeline.assetActions.placeholder', { defaultValue: 'Example: keep the same framing, but make the dialogue tenser and the lighting colder.' })}
                    className="min-h-24 resize-none border-orange-400/15 bg-white/55 text-sm dark:bg-white/5"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-orange-400/10 px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setModifyMode(false);
                    setModifyPrompt('');
                  }}
                  disabled={regenerating}
                  className="h-8 rounded-lg border-orange-400/20 bg-white/60 hover:bg-white/80 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  {t('canvas:timeline.assetActions.cancel', { defaultValue: 'Cancel' })}
                </Button>
                  <Button
                    type="button"
                    onClick={() => void handleRegenerate(modifyPrompt)}
                    disabled={regenerating || !modifyPrompt.trim()}
                    className="h-8 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
                  >
                    {regenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t('canvas:timeline.actions.modifyThenRegenerate', { defaultValue: 'Modify and regenerate' })}
                  </Button>
                </div>
              </>
            ) : (
              <div className="px-3 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleRegenerate()}
                  disabled={regenerating}
                  className="h-9 w-full justify-start rounded-lg text-sm"
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  {t('canvas:timeline.actions.regenerate', { defaultValue: 'Regenerate' })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setModifyMode(true)}
                  disabled={regenerating}
                  className="mt-1 h-9 w-full justify-start rounded-lg text-sm"
                >
                  <Wand2 className="mr-2 h-3.5 w-3.5" />
                  {t('canvas:timeline.actions.howToModify', { defaultValue: 'How to modify?' })}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : null}

      {/* Asset icon */}
      {isCollapsedCompact ? null : (
        <div className="flex-shrink-0">
          {getAssetIcon()}
        </div>
      )}

      {/* Asset content */}
      {renderAssetContent()}

      {/* Duration indicator */}
      {isCollapsedCompact ? null : (
        <div className="flex-shrink-0 text-xs opacity-75 font-medium">
          {asset.duration.toFixed(1)}s
        </div>
      )}

      {review ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn('ml-1 flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', reviewToneClass)}>
              <div className="flex items-center gap-1">
                {reviewStatus === 'approved_auto' ? (
                  <ShieldCheck className="h-3 w-3" />
                ) : reviewStatus === 'attention_needed' ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                <span>{Number.isFinite(reviewScore) ? reviewScore : '--'}</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-80 border border-black/10 bg-white/95 p-3 text-gray-900 shadow-xl dark:border-white/10 dark:bg-black/95 dark:text-white"
          >
            <div className="space-y-2 text-[11px] leading-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">Review</div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/45 dark:text-white/45">
                  {reviewStatus || 'needs_review'}
                </div>
              </div>
              {review.summary ? (
                <div className="text-black/70 dark:text-white/72">{review.summary}</div>
              ) : null}
              {review.promptReview?.promptExcerpt ? (
                <div className="rounded-md bg-black/[0.04] px-2 py-1.5 text-black/65 dark:bg-white/[0.06] dark:text-white/68">
                  {review.promptReview.promptExcerpt}
                </div>
              ) : null}
              {reviewChecks.length ? (
                <div className="space-y-1">
                  {reviewChecks.map((check) => (
                    <div key={`${asset.id}-${check.name}`} className="flex items-start gap-2">
                      <span className={cn('mt-0.5 inline-block h-1.5 w-1.5 rounded-full', check.status === 'ok' ? 'bg-emerald-500' : check.status === 'error' ? 'bg-red-500' : 'bg-amber-500')} />
                      <span className="text-black/68 dark:text-white/72">{check.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
