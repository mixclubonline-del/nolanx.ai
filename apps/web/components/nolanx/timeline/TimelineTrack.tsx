"use client";

import React, { useCallback } from 'react';
import { TimelineTrack, TimelineConfig, TimelineAsset } from '@/lib/nolanx/types/timeline';
import { AssetItem } from './AssetItem';
import { cn } from '@/lib/utils';

interface TimelineTrackProps {
  canvasId: string;
  track: TimelineTrack;
  currentTime: number;
  selectedAssets: string[];
  config: TimelineConfig;
  onSelectAsset: (assetId: string) => void;
  onPatchAsset: (asset: TimelineAsset) => void;
  laneMode?: 'collapsed' | 'expanded';
  isLast: boolean;
}

export function TimelineTrackComponent({
  canvasId,
  track,
  currentTime,
  selectedAssets,
  config,
  onSelectAsset,
  onPatchAsset,
  laneMode,
  isLast,
}: TimelineTrackProps) {
  const handleAssetSelect = useCallback((assetId: string) => {
    onSelectAsset(assetId);
  }, [onSelectAsset]);

  // 判断是否为低优先级轨道
  const isLowPriority = track.type === 'keyframe';
  const isScriptTrack = track.type === 'script';
  const isWorldTrack = track.type === 'world';

  return (
    <div
      className={cn(
        "h-full relative cursor-pointer",
        isScriptTrack
          ? "bg-gradient-to-r from-orange-50/20 to-white/15 dark:from-orange-950/20 dark:to-black/10"
          : isWorldTrack
            ? "bg-gradient-to-r from-orange-50/10 to-white/10 dark:from-orange-950/15 dark:to-black/10"
          : isLowPriority
            ? "bg-gradient-to-r from-gray-50/10 to-white/10 dark:from-gray-900/10 dark:to-black/10 opacity-75"
            : "bg-gradient-to-r from-gray-50/20 to-white/20 dark:from-gray-900/20 dark:to-black/20"
      )}
      style={{
        // 扩展容器宽度，确保虚影可以移动到更远的位置
        minWidth: '200vw', // 至少2倍视口宽度
        // 为轨道添加点状/网格背景
        ...(isScriptTrack
          ? {
            backgroundImage: `radial-gradient(circle at 3px 3px, rgba(249, 115, 22, 0.18) 0.6px, transparent 0.6px)`,
            backgroundSize: '14px 14px',
            backgroundPosition: '0 0',
          }
          : isWorldTrack
            ? {
              backgroundImage: `radial-gradient(circle at 3px 3px, rgba(249, 115, 22, 0.12) 0.6px, transparent 0.6px)`,
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0',
            }
          : isLowPriority
            ? {
              backgroundImage: `radial-gradient(circle at 3px 3px, rgba(156, 163, 175, 0.2) 0.5px, transparent 0.5px)`,
              backgroundSize: '12px 12px',
              backgroundPosition: '0 0',
            }
            : {}),
      }}
    >
        {/* Assets */}
	        {track.assets.map((asset, index) => (
	          <AssetItem
	            key={asset.id}
              canvasId={canvasId}
	            asset={asset}
	            track={track}
	            index={index}
	            config={config}
	            isSelected={selectedAssets.includes(asset.id)}
	            laneMode={laneMode}
	            onSelect={handleAssetSelect}
              onPatchAsset={onPatchAsset}
	          />
	        ))}

        {/* Current Time Indicator removed - using unified playhead in TimelineTrackList */}
    </div>
  );
}
