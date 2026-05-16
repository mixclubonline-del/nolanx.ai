"use client";

import React from 'react';
import { Play, Pause, ZoomIn, ZoomOut, Expand } from 'lucide-react';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';
import { eventBus } from '@/lib/nolanx/utils/event';

interface TimelineControlsProps {
  canvasId?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  zoom: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onZoom: (zoom: number) => void;
}

export function TimelineControls({
  canvasId,
  isPlaying,
  currentTime,
  duration,
  zoom,
  onPlay,
  onPause,
  onSeek,
  onZoom,
}: TimelineControlsProps) {
  const { t } = useTranslation();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      onPause();
    } else {
      onPlay();
    }
  };

  const handleZoomIn = () => {
    onZoom(Math.min(zoom * 1.5, 10));
  };

  const handleZoomOut = () => {
    onZoom(Math.max(zoom / 1.5, 0.1));
  };

  const handleExportFullscreen = () => {
    if (!canvasId) return;
    eventBus.emit('Canvas::Preview::ExportFullscreen', { canvasId });
  };

  return (
    <div className="relative h-12 bg-gradient-to-r from-gray-50/30 to-white/30 dark:from-gray-900/30 dark:to-black/30">
      <div className="flex items-center px-4 h-full">
        {/* Playback Controls - 左侧 */}
        <div className="flex items-center gap-3">
          {isMobile ? (
            <button
              onClick={handleExportFullscreen}
              className="flex items-center gap-1.5 p-2.5 rounded-xl bg-white/90 dark:bg-black/90 backdrop-blur-sm border border-black/30 dark:border-white/20 hover:border-black/50 dark:hover:border-white/30 transition-all duration-200 hover:scale-105 shadow-lg"
            >
              <Play className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <Expand className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
            </button>
          ) : (
            <div className="group flex items-center gap-2">
              <button
                onClick={handlePlayPause}
                className="p-2.5 rounded-xl bg-white/80 dark:bg-black/80 backdrop-blur-sm border border-black/30 dark:border-white/20 hover:border-black/50 dark:hover:border-white/30 transition-all duration-200 hover:scale-105 shadow-lg"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                ) : (
                  <Play className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                )}
              </button>

              <button
                onClick={handleExportFullscreen}
                className="pointer-events-none -ml-1 translate-x-2 opacity-0 p-2.5 rounded-xl bg-white/92 text-black dark:bg-black/92 dark:text-white backdrop-blur-sm border border-black/20 dark:border-white/20 shadow-lg transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100"
              >
                <Expand className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Time Display */}
          <div className="flex items-center gap-1 bg-white/80 dark:bg-black/80 backdrop-blur-sm border border-black/30 dark:border-white/20 px-4 py-2 rounded-xl shadow-lg">
            <span className="text-sm font-semibold text-gray-800 dark:text-white">
              {formatTime(currentTime)}
            </span>
            <span className="text-sm text-orange-500 dark:text-orange-400 mx-1">/</span>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {formatTime(duration)}
            </span>
          </div>
        </div>

      </div>



      {/* 控件下方的完整横线 */}
      <div
        className="absolute bottom-0 left-0 h-px bg-gray-300 dark:bg-white/20"
        style={{
          width: '100vw',
          minWidth: '2000px'
        }}
      />
    </div>
  );
}
