"use client";

import React from 'react';

interface SnapIndicatorProps {
  isVisible: boolean;
  position: number; // Position in pixels
  height: number;
}

export function SnapIndicator({ isVisible, position, height }: SnapIndicatorProps) {
  if (!isVisible) return null;

  return (
    <div
      className="absolute top-0 w-0.5 bg-orange-500 dark:bg-orange-400 shadow-lg z-30 pointer-events-none opacity-80"
      style={{
        left: position,
        height: height,
      }}
    >
      {/* Snap indicator line with glow effect */}
      <div className="absolute inset-0 bg-orange-500 dark:bg-orange-400 blur-sm opacity-50" />
    </div>
  );
}
