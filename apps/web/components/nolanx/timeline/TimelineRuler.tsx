"use client";

import React, { useCallback, useRef } from 'react';
import { TimelineConfig } from '@/lib/nolanx/types/timeline';
import { cn } from '@/lib/utils';

interface TimelineRulerProps {
  duration: number;
  currentTime: number;
  config: TimelineConfig;
  onSeek: (time: number) => void;
}

export function TimelineRuler({ duration, currentTime, config, onSeek }: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);

  // Calculate time markers
  const getTimeMarkers = useCallback(() => {
    const markers: { time: number; label: string; major: boolean }[] = [];

    // Determine marker interval based on zoom level
    let interval = 1; // seconds
    if (config.pixelsPerSecond < 20) {
      interval = 10;
    } else if (config.pixelsPerSecond < 50) {
      interval = 5;
    } else if (config.pixelsPerSecond > 200) {
      interval = 0.5;
    }

    // Extend markers beyond duration for infinite scroll
    const maxTime = Math.max(duration + 30, 120); // At least 2 minutes of markers
    for (let time = 0; time <= maxTime; time += interval) {
      const isMajor = time % (interval * 5) === 0;
      markers.push({
        time,
        label: formatTime(time),
        major: isMajor,
      });
    }

    return markers;
  }, [duration, config.pixelsPerSecond]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    
    if (config.pixelsPerSecond > 200) {
      return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [config.pixelsPerSecond]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!rulerRef.current) return;
    
    const rect = rulerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / config.pixelsPerSecond;
    
    onSeek(Math.max(0, Math.min(time, duration)));
  }, [config.pixelsPerSecond, duration, onSeek]);

  const timeMarkers = getTimeMarkers();
  const playheadPosition = currentTime * config.pixelsPerSecond;

  return (
    <div
      ref={rulerRef}
      className="relative h-full border-b border-gray-300 dark:border-white/20 bg-gradient-to-r from-gray-50/20 to-white/20 dark:from-gray-900/20 dark:to-black/20 cursor-pointer select-none"
      onClick={handleClick}
      style={{ width: Math.max(duration * config.pixelsPerSecond, 2000) }} // Minimum width for infinite scroll
    >
      {/* Time markers */}
      {timeMarkers.map((marker) => {
        const position = marker.time * config.pixelsPerSecond;

        return (
          <div
            key={marker.time}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: position }}
          >
            {/* Tick mark */}
            <div
              className={cn(
                "bg-black/40 dark:bg-white/30",
                marker.major ? "w-px h-6" : "w-px h-3"
              )}
            />

            {/* Time label */}
            {marker.major && (
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 mt-1 whitespace-nowrap">
                {marker.label}
              </span>
            )}
          </div>
        );
      })}

      {/* Playhead - only the handle, line will be drawn by parent */}
      <div
        className="absolute top-0 w-0.5 h-full bg-orange-500 dark:bg-orange-400 shadow-lg z-10"
        style={{ left: playheadPosition }}
      >
        {/* Playhead handle */}
        <div className="absolute -top-1 -left-2 w-4 h-4 bg-orange-500 dark:bg-orange-400 rounded-b-lg shadow-md" />
      </div>

      {/* 横线已移至TimelineControls下方 */}
    </div>
  );
}
