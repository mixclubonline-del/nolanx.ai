"use client";

import React from 'react';
import { TimelineTrack, TimelineConfig, TimelineAsset } from '@/lib/nolanx/types/timeline';
import { TimelineTrackComponent } from './TimelineTrack';
import { cn } from '@/lib/utils';

interface TimelineTrackListProps {
  canvasId: string;
  tracks: TimelineTrack[];
  currentTime: number;
  selectedAssets: string[];
  config: TimelineConfig;
  onSelectAsset: (assetId: string) => void;
  onPatchAsset: (asset: TimelineAsset) => void;
  laneHeights?: Partial<Record<TimelineTrack['type'], string>>;
  expandedTrack?: 'world' | 'script' | null;
  onHoverExpandableTrack?: (trackType: 'world' | 'script' | null) => void;
}

export function TimelineTrackList({
  canvasId,
  tracks,
  currentTime,
  selectedAssets,
  config,
  onSelectAsset,
  onPatchAsset,
  laneHeights,
  expandedTrack,
  onHoverExpandableTrack,
}: TimelineTrackListProps) {
  // Fixed track order and heights
  const trackOrder: Array<TimelineTrack['type']> = ['script', 'world', 'keyframe', 'video', 'audio'];
  const orderedTracks = trackOrder.map(type =>
    tracks.find(track => track.type === type)
  ).filter(Boolean) as typeof tracks;

  const defaultLaneHeight = orderedTracks.length > 0 ? `${100 / orderedTracks.length}%` : '25%';

  return (
    <div className="relative flex flex-col h-full"> {/* 使用父容器的100%高度 */}
      {orderedTracks.map((track, index) => (
        <div
          key={track.id}
          className={cn(
            "relative transition-[height] duration-200 ease-out",
            index < orderedTracks.length - 1 && "border-b border-gray-200 dark:border-white/10"
          )}
          style={{ height: laneHeights?.[track.type] || defaultLaneHeight }}
          onMouseEnter={
            (track.type === 'world' || track.type === 'script') && onHoverExpandableTrack
              ? () => onHoverExpandableTrack(track.type as 'world' | 'script')
              : undefined
          }
          onMouseLeave={
            (track.type === 'world' || track.type === 'script') && onHoverExpandableTrack
              ? () => onHoverExpandableTrack(null)
              : undefined
          }
        >
          <TimelineTrackComponent
            canvasId={canvasId}
            track={track}
            currentTime={currentTime}
            selectedAssets={selectedAssets}
            config={config}
            onSelectAsset={onSelectAsset}
            onPatchAsset={onPatchAsset}
            laneMode={
              track.type === 'world' || track.type === 'script'
                ? (expandedTrack === track.type ? 'expanded' : 'collapsed')
                : undefined
            }
            isLast={index === orderedTracks.length - 1}
          />

          {/* Infinite horizontal separator line - only for script track (dashed) */}
          {track.type === 'script' && (
            <div
              className="absolute bottom-0 left-0 h-px z-10 border-b border-dashed border-gray-300/60 dark:border-white/15 bg-transparent"
              style={{
                width: '100vw', // Extends infinitely to the right
                minWidth: '2000px' // Minimum width for very wide timelines
              }}
            />
          )}
        </div>
      ))}

      {/* Continuous playhead line across all tracks */}
      <div
        className="absolute top-0 w-0.5 bg-orange-500 dark:bg-orange-400 shadow-lg z-20 pointer-events-none"
        style={{
          left: currentTime * config.pixelsPerSecond,
          height: '100%',
        }}
      />
    </div>
  );
}
