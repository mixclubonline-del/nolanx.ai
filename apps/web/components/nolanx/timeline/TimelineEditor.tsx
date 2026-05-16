"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TimelineData, TimelineState, TimelineAsset, TimelineTrack, DEFAULT_TIMELINE_CONFIG } from '@/lib/nolanx/types/timeline';
import { PreviewPlayer } from './PreviewPlayer';
import { TimelineTrackList } from './TimelineTrackList';
import { TimelineRuler } from './TimelineRuler';
import { TimelineControls } from './TimelineControls';
import { SaveIndicator } from './SaveIndicator';
import { useTimelineData } from '@/lib/nolanx/hooks/useTimelineData';
import { FileText, Image, Video, Volume2, ZoomIn, ZoomOut, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { eventBus, TEvents } from '@/lib/nolanx/utils/event';
import { videoCacheManager } from '@/lib/nolanx/utils/videoCacheManager';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';
import { ScriptDrawer } from './ScriptDrawer';


interface TimelineEditorProps {
  canvasId: string;
  initialData?: any;
  sessionList?: any[];
  canvasData?: any; // Current canvas data for real-time updates
  isShared?: boolean; // Whether this is a shared canvas (read-only mode)
}

export function TimelineEditor({ canvasId, initialData, sessionList = [], canvasData, isShared = false }: TimelineEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const lastCanvasDataRef = useRef<string>('');
  const refreshTimeoutRef = useRef<number | null>(null);
  const [scriptDrawerOpen, setScriptDrawerOpen] = useState(false);
  const [scriptDrawerInitialTab, setScriptDrawerInitialTab] = useState<"script" | "elements" | "shots">("script");
  const [hoveredExpandableTrack, setHoveredExpandableTrack] = useState<"world" | "script" | null>(null);
  const hoverCollapseTimeoutRef = useRef<number | null>(null);
  const [timelineState, setTimelineState] = useState<TimelineState>({
    isPlaying: false,
    currentTime: 0,
    duration: 30, // default 30 seconds
    zoom: 1,
    selectedAssets: [],
  });



  // Load timeline data from chat sessions and canvas data
  // Use canvasData if available, otherwise fall back to initialData
  const currentCanvasData = canvasData || initialData;
  const { timelineData, updateTimelineData, patchTimelineAsset, refreshTimelineData, forceRearrangeAllLanes, isSaving, lastSaveTime } = useTimelineData(canvasId, sessionList, currentCanvasData);

  // Monitor canvas data changes and refresh timeline when needed
  useEffect(() => {
    if (canvasData && refreshTimelineData) {
      // Create a hash of the canvas data to detect meaningful changes
      const currentDataHash = JSON.stringify({
        elementsCount: canvasData.elements?.length || 0,
        filesCount: Object.keys(canvasData.files || {}).length,
        elementIds: canvasData.elements?.map((e: any) => e.id).sort(),
        fileIds: Object.keys(canvasData.files || {}).sort()
      });

      if (currentDataHash !== lastCanvasDataRef.current) {
        console.log('🔄 Canvas data changed, refreshing timeline...', {
          hasElements: !!canvasData.elements,
          hasFiles: !!canvasData.files,
          elementsCount: canvasData.elements?.length,
          filesCount: Object.keys(canvasData.files || {}).length
        });

        lastCanvasDataRef.current = currentDataHash;

        // Small delay to ensure data is fully updated
        if (refreshTimeoutRef.current) {
          window.clearTimeout(refreshTimeoutRef.current);
        }

        refreshTimeoutRef.current = window.setTimeout(() => {
          refreshTimelineData();
        }, 100);
      }
    }

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [canvasData, refreshTimelineData]);

  // Listen for canvas data updates from chat (only for new content, not timeline saves)
  useEffect(() => {
    const handleCanvasDataUpdate = (data: TEvents['Canvas::DataUpdated']) => {
      if (data.canvasId === canvasId) {
        console.log('🔄 TimelineEditor received canvas data update event:', data.trigger);

        // Only refresh for new content generation, not for timeline operations
        if (!canvasData && (
          data.trigger === 'image_generated' ||
          data.trigger === 'video_generated' ||
          data.trigger === 'audio_generated' ||
          data.trigger === 'script_generated'
        )) {
          console.log('🔄 Refreshing timeline for new content generation');
          window.setTimeout(() => {
            refreshTimelineData();
          }, 500);
        } else {
          console.log('⏭️ Skipping refresh for non-content update:', data.trigger);
        }
      }
    };

    eventBus.on('Canvas::DataUpdated', handleCanvasDataUpdate);

    return () => {
      eventBus.off('Canvas::DataUpdated', handleCanvasDataUpdate);
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [canvasId, canvasData, refreshTimelineData]);

  // Timeline configuration
  const config = {
    ...DEFAULT_TIMELINE_CONFIG,
    pixelsPerSecond: DEFAULT_TIMELINE_CONFIG.pixelsPerSecond * timelineState.zoom,
  };

  // Update duration when timeline data changes
  useEffect(() => {
    if (timelineData.duration !== timelineState.duration) {
      console.log('📏 Timeline duration updated in editor:', {
        from: timelineState.duration,
        to: timelineData.duration,
        tracks: timelineData.tracks.length,
        trigger: 'timelineData.duration changed'
      });
      setTimelineState(prev => ({ ...prev, duration: timelineData.duration }));
    }
  }, [timelineData.duration, timelineState.duration]);

  // 视频轨道预加载：按时间顺序一次性入队，由缓存器控制并发
  useEffect(() => {
    const videoTrack = timelineData.tracks.find(t => t.type === 'video');
    if (!videoTrack?.assets.length) return;

    const sortedVideos = [...videoTrack.assets]
      .filter(asset => asset.content.videoUrl)
      .sort((a, b) => a.startTime - b.startTime);

    if (sortedVideos.length === 0) return;

    console.log('🎬 Queueing timeline video preloads:', {
      totalVideos: sortedVideos.length,
      timeRange: `${sortedVideos[0].startTime.toFixed(1)}s - ${(sortedVideos[sortedVideos.length - 1].startTime + sortedVideos[sortedVideos.length - 1].duration).toFixed(1)}s`
    });

    videoCacheManager.preloadVideos(
      sortedVideos.map((asset, index) => ({
        url: asset.content.videoUrl!,
        priority: Math.max(1, 10 - index),
        mode: 'timeline' as const,
      }))
    );
  }, [timelineData.tracks]);

  // 统一时间源 - 播放时以固定速率更新时间
  const playbackStartTimeRef = useRef<number>(0);
  const playbackStartCurrentTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // 播放循环 - 统一时间源
  useEffect(() => {
    if (timelineState.isPlaying) {
      playbackStartTimeRef.current = performance.now();
      playbackStartCurrentTimeRef.current = timelineState.currentTime;

      const updateTime = () => {
        if (!timelineState.isPlaying) return; // 防止状态变化后继续执行

        const elapsed = (performance.now() - playbackStartTimeRef.current) / 1000;
        const newTime = playbackStartCurrentTimeRef.current + elapsed;

        if (newTime >= timelineState.duration) {
          // 播放结束，暂停
          setTimelineState(prev => ({
            ...prev,
            isPlaying: false,
            currentTime: prev.duration
          }));
        } else {
          // 更新时间
          setTimelineState(prev => ({
            ...prev,
            currentTime: newTime
          }));
          animationFrameRef.current = requestAnimationFrame(updateTime);
        }
      };

      animationFrameRef.current = requestAnimationFrame(updateTime);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [timelineState.isPlaying]); // 只依赖isPlaying，避免duration变化导致重复执行

  // 简单直接的自动滚动 - 指针离窗口边框80px时，窗口自动滚动一段距离
  // 使用节流来防止移动端的闪烁问题
  const lastScrollTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!timelineContainerRef.current) return;

    // 节流：500ms内只允许一次滚动
    const now = Date.now();
    if (now - lastScrollTimeRef.current < 500) return;

    const container = timelineContainerRef.current;
    const currentTimePosition = timelineState.currentTime * config.pixelsPerSecond;
    const containerWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;
    const scrollRight = scrollLeft + containerWidth;

    // 设置触发距离：距离边框80px (移动端使用更小的值)
    const isMobileView = window.innerWidth < 768;
    const triggerDistance = isMobileView ? 40 : 80;

    // 检查是否需要向右滚动（播放指针距离右边框）
    if (currentTimePosition > scrollRight - triggerDistance) {
      lastScrollTimeRef.current = now;
      const scrollDistance = containerWidth * 0.8;
      container.scrollTo({
        left: scrollLeft + scrollDistance,
        behavior: 'smooth'
      });
    }

    // 检查是否需要向左滚动（播放指针距离左边框）
    else if (currentTimePosition < scrollLeft + triggerDistance && scrollLeft > 0) {
      lastScrollTimeRef.current = now;
      const scrollDistance = containerWidth * 0.5;
      container.scrollTo({
        left: Math.max(0, scrollLeft - scrollDistance),
        behavior: 'smooth'
      });
    }
  }, [timelineState.currentTime, config.pixelsPerSecond]);

  // Playback control
  const handlePlay = useCallback(() => {
    console.log('▶️ Play started at time:', timelineState.currentTime.toFixed(2));
    setTimelineState(prev => ({ ...prev, isPlaying: true }));
  }, [timelineState.currentTime]);

  const handlePause = useCallback(() => {
    console.log('⏸️ Paused at time:', timelineState.currentTime.toFixed(2));
    setTimelineState(prev => ({ ...prev, isPlaying: false }));
  }, [timelineState.currentTime]);

  const handleSeek = useCallback((time: number) => {
    const clampedTime = Math.max(0, Math.min(time, timelineState.duration));
    console.log('🎯 Seek to time:', clampedTime.toFixed(2));

    setTimelineState(prev => ({
      ...prev,
      currentTime: clampedTime,
      // 如果正在播放，需要重新同步播放起始时间
      ...(prev.isPlaying && {
        // 这里会触发useEffect重新开始播放循环
      })
    }));
  }, [timelineState.duration]);

  const handleZoom = useCallback((zoom: number) => {
    setTimelineState(prev => ({
      ...prev,
      zoom: Math.max(config.minZoom, Math.min(zoom, config.maxZoom))
    }));
  }, [config.minZoom, config.maxZoom]);

  // Asset selection
  const handleSelectAsset = useCallback((assetId: string) => {
    setTimelineState(prev => ({
      ...prev,
      selectedAssets: [assetId]
    }));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setTimelineState(prev => ({
      ...prev,
      selectedAssets: []
    }));
  }, []);

  const handleDeleteAsset = useCallback((assetId: string) => {
    updateTimelineData(prev => {
      const newData = { ...prev };
      for (const track of newData.tracks) {
        const assetIndex = track.assets.findIndex(a => a.id === assetId);
        if (assetIndex !== -1) {
          track.assets.splice(assetIndex, 1);
          break;
        }
      }
      return newData;
    });
    setTimelineState(prev => ({
      ...prev,
      selectedAssets: prev.selectedAssets.filter(id => id !== assetId)
    }));
  }, [updateTimelineData]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          timelineState.isPlaying ? handlePause() : handlePlay();
          break;
        case 'Delete':
        case 'Backspace':
          if (timelineState.selectedAssets.length > 0) {
            timelineState.selectedAssets.forEach(handleDeleteAsset);
          }
          break;
        case 'Escape':
          handleDeselectAll();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [timelineState.isPlaying, timelineState.selectedAssets, handlePlay, handlePause, handleDeleteAsset, handleDeselectAll]);

  // 删除所有loading timeline逻辑，直接显示Timeline

  const worldTrack = timelineData.tracks.find((track) => track.type === "world");
  const scriptTrack = timelineData.tracks.find((track) => track.type === "script");
  const trackHeaderOrder: Array<TimelineTrack['type']> = ['script', 'world', 'keyframe', 'video', 'audio'];
  const orderedHeaderTracks = trackHeaderOrder.map(type => timelineData.tracks.find(track => track.type === type)).filter(Boolean) as TimelineTrack[];
  const handleExpandableTrackHover = useCallback((trackType: "world" | "script" | null) => {
    if (hoverCollapseTimeoutRef.current) {
      window.clearTimeout(hoverCollapseTimeoutRef.current);
      hoverCollapseTimeoutRef.current = null;
    }

    if (trackType) {
      setHoveredExpandableTrack(trackType);
      return;
    }

    // Small delay avoids flicker when moving between header and lane
    hoverCollapseTimeoutRef.current = window.setTimeout(() => {
      setHoveredExpandableTrack(null);
      hoverCollapseTimeoutRef.current = null;
    }, 120);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverCollapseTimeoutRef.current) {
        window.clearTimeout(hoverCollapseTimeoutRef.current);
        hoverCollapseTimeoutRef.current = null;
      }
    };
  }, []);

  const laneHeightPercent = useMemo(() => {
    const collapsed = { world: 9, script: 11, keyframe: 24, video: 34, audio: 22 } as const;
    const expandedWorld = { world: 22, script: 9, keyframe: 21, video: 30, audio: 18 } as const;
    const expandedScript = { world: 8, script: 24, keyframe: 21, video: 30, audio: 17 } as const;

    if (hoveredExpandableTrack === "world") return expandedWorld;
    if (hoveredExpandableTrack === "script") return expandedScript;
    return collapsed;
  }, [hoveredExpandableTrack]);

  const laneHeights = useMemo(() => {
    return {
      world: `${laneHeightPercent.world}%`,
      script: `${laneHeightPercent.script}%`,
      keyframe: `${laneHeightPercent.keyframe}%`,
      video: `${laneHeightPercent.video}%`,
      audio: `${laneHeightPercent.audio}%`,
    } as const;
  }, [laneHeightPercent]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full bg-white dark:bg-black overflow-hidden"
      onClick={handleDeselectAll}
    >
      {/* Preview Player - 占屏幕高度的4/9 (约44.4%) */}
      <div className="relative p-4" style={{ height: '44.44%' }}>
        <PreviewPlayer
          canvasId={canvasId}
          timelineData={timelineData}
          currentTime={timelineState.currentTime}
          isPlaying={timelineState.isPlaying}
          onSeek={handleSeek}
          onPlay={handlePlay}
          onPause={handlePause}
        />
      </div>

      {/* Timeline Section - 占屏幕高度的5/9 (约55.6%) */}
      <div className="p-4 pt-0" style={{ height: '55.56%' }}>
        <div className="h-full rounded-2xl bg-white/90 dark:bg-black/90 backdrop-blur-xl border border-black dark:border-white/30 shadow-2xl overflow-hidden flex flex-col">
          {/* Timeline Controls - 占timeline container屏幕高度的10% */}
          <div className="flex items-center justify-between relative" style={{ height: '10%', minHeight: '50px' }}>
            <TimelineControls
              canvasId={canvasId}
              isPlaying={timelineState.isPlaying}
              currentTime={timelineState.currentTime}
              duration={timelineState.duration}
              zoom={timelineState.zoom}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
              onZoom={handleZoom}
            />

            {/* Zoom Controls - 绝对定位居中 (hidden on mobile) */}
            <div className="hidden md:flex absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 items-center gap-2">
              <button
                onClick={() => handleZoom(Math.max(timelineState.zoom / 1.5, 0.1))}
                className="p-2 rounded-xl bg-white/80 dark:bg-black/80 backdrop-blur-sm border border-black/30 dark:border-white/20 hover:border-black/50 dark:hover:border-white/30 transition-all duration-200 hover:scale-105 shadow-lg"
              >
                <ZoomOut className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </button>

              <div className="bg-white/80 dark:bg-black/80 backdrop-blur-sm border border-black/30 dark:border-white/20 px-3 py-2 rounded-xl shadow-lg">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">
                  {Math.round(timelineState.zoom * 100)}%
                </span>
              </div>

              <button
                onClick={() => handleZoom(Math.min(timelineState.zoom * 1.5, 10))}
                className="p-2 rounded-xl bg-white/80 dark:bg-black/80 backdrop-blur-sm border border-black/30 dark:border-white/20 hover:border-black/50 dark:hover:border-white/30 transition-all duration-200 hover:scale-105 shadow-lg"
              >
                <ZoomIn className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </button>
            </div>

            {/* Rearrange Button and Save Indicator (hidden on mobile) */}
            <div className="hidden md:flex items-center gap-2 mr-4">
              <button
                onClick={forceRearrangeAllLanes}
                className="p-2 rounded-xl bg-white/80 dark:bg-black/80 backdrop-blur-sm border border-black/30 dark:border-white/20 hover:border-black/50 dark:hover:border-white/30 transition-all duration-200 hover:scale-105 shadow-lg"
              >
                <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6v12M16 6v12" />
                </svg>
              </button>

              <SaveIndicator
                isSaving={isSaving}
                lastSaveTime={lastSaveTime}
              />
            </div>
          </div>

          {/* Timeline Content - 占剩余90%高度 */}
          <div className="flex" style={{ height: '90%' }}>
            {/* Track Headers - 左侧固定宽度 */}
            <div className="w-32 border-r border-gray-300 dark:border-white/20 bg-gradient-to-b from-gray-50/50 to-white/50 dark:from-gray-900/50 dark:to-black/50 flex flex-col">
              {/* Tracks标题区域 - 占timeline container屏幕高度的1/8 (12.5%) */}
              <div className="border-b border-gray-300 dark:border-white/20 flex items-center justify-center" style={{ height: '12.5%', minHeight: '40px' }}>
                <span className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
                  {t('canvas:timeline.tracksTitle')}
                </span>
              </div>

              {/* Track headers */}
	              <div className="flex flex-col flex-1">
	                {orderedHeaderTracks.map((track, idx) => {
	                  const isClickable = track.type === "script" || track.type === "world";
	                  const isExpandable = track.type === "script" || track.type === "world";
	                  const isExpanded = isExpandable && hoveredExpandableTrack === track.type;
	                  const Icon =
	                    track.type === "world" ? Layers :
	                    track.type === "script" ? FileText :
	                    track.type === "keyframe" ? Image :
                    track.type === "video" ? Video :
                    Volume2;

                  const labelKey = `canvas:timeline.trackLabels.${track.type}` as const;
                  const isDim = track.type === "keyframe";

	                  const headerContent = (
	                    <div className={cn("flex flex-col items-center justify-center gap-1 min-h-0", isDim && "opacity-60")}>
	                      <div
	                        className={cn(
	                          "relative w-9 h-9 rounded-2xl bg-white/70 dark:bg-black/70 backdrop-blur-sm border border-black/15 dark:border-white/15 flex items-center justify-center shadow-sm transition-all",
	                          isClickable ? "group-hover:shadow-md" : "shadow-sm",
	                          isDim && "border-dashed border-black/20 dark:border-white/15 w-8 h-8 rounded-xl",
	                          !isClickable && !isDim && "bg-white/80 dark:bg-black/80 border-black/30 dark:border-white/20 shadow-lg w-8 h-8 rounded-xl",
	                          isExpandable && !isExpanded && "w-7 h-7 rounded-xl",
	                        )}
	                      >
	                        {isClickable ? (
	                          <div
	                            className={cn(
	                              "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[linear-gradient(90deg,rgba(255,90,0,0.22),rgba(255,154,31,0.22))]",
	                              isExpandable && !isExpanded ? "rounded-xl" : "rounded-2xl",
	                            )}
	                          />
	                        ) : null}
	                        <Icon
	                          className={cn(
	                            "relative w-4 h-4",
	                            isClickable ? "text-orange-600 dark:text-orange-400" : "text-orange-600/60 dark:text-orange-400/60",
	                            isExpandable && !isExpanded && "w-3.5 h-3.5",
	                          )}
	                        />
	                      </div>
	                      {!isExpandable || isExpanded ? (
	                        <span
	                          className={cn(
	                            "text-[11px] text-center transition-colors leading-none",
	                            isClickable
	                              ? "font-semibold text-gray-800 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400"
	                              : isDim
	                                ? "font-medium text-gray-600/80 dark:text-white/60"
	                                : "font-semibold text-gray-800 dark:text-white",
	                          )}
	                        >
	                          {t(labelKey)}
	                        </span>
	                      ) : null}
	                    </div>
	                  );

	                  return (
	                    <div
	                      key={track.id}
	                      className={cn(
	                        "flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out",
	                        idx < orderedHeaderTracks.length - 1 && "border-b border-gray-300 dark:border-white/20",
	                      )}
	                      style={{ height: laneHeights[track.type] || `${100 / orderedHeaderTracks.length}%` }}
	                      onMouseEnter={
	                        isExpandable
	                          ? () => handleExpandableTrackHover(track.type as "world" | "script")
	                          : undefined
	                      }
	                      onMouseLeave={isExpandable ? () => handleExpandableTrackHover(null) : undefined}
	                    >
	                      {isClickable ? (
	                        <button
	                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setScriptDrawerInitialTab(track.type === "world" ? "elements" : "script");
                            setScriptDrawerOpen(true);
                          }}
                          className="group w-full h-full flex items-center justify-center"
                          aria-label={t("canvas:timeline.scriptDrawer.open")}
                        >
                          {headerContent}
                        </button>
                      ) : (
                        headerContent
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Timeline Area with synchronized scrolling */}
            <div className="flex-1 overflow-hidden bg-gradient-to-b from-gray-50/30 to-white/30 dark:from-gray-900/30 dark:to-black/30 flex flex-col">
              {/* Ruler and Tracks Container with synchronized horizontal scroll */}
              <div className="overflow-auto timeline-container h-full" ref={timelineContainerRef}>
                <div className="relative h-full flex flex-col">
                  {/* Ruler - 占12.5%高度，与Tracks标题对齐 */}
                  <div className="sticky top-0 z-10" style={{ height: '12.5%', minHeight: '40px' }}>
                    <TimelineRuler
                      duration={timelineState.duration}
                      currentTime={timelineState.currentTime}
                      config={config}
                      onSeek={handleSeek}
                    />
                  </div>

                  {/* Tracks - 占87.5%高度，4个track平分 */}
	                  <div className="relative" style={{ height: '87.5%' }}>
		                    <TimelineTrackList
	                        canvasId={canvasId}
		                      tracks={timelineData.tracks}
		                      currentTime={timelineState.currentTime}
		                      selectedAssets={timelineState.selectedAssets}
		                      config={config}
		                      onSelectAsset={handleSelectAsset}
		                      onPatchAsset={patchTimelineAsset}
		                      laneHeights={laneHeights}
		                      expandedTrack={hoveredExpandableTrack}
		                      onHoverExpandableTrack={handleExpandableTrackHover}
		                    />
	                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      <ScriptDrawer
        open={scriptDrawerOpen}
        onOpenChange={setScriptDrawerOpen}
        initialTab={scriptDrawerInitialTab}
        track={scriptTrack}
        worldTrack={worldTrack}
        onSeek={(timeSeconds) => {
          handleSeek(timeSeconds);
          setScriptDrawerOpen(false);
        }}
      />

    </div>
  );
}
