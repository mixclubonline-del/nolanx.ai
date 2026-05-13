// Timeline Editor Data Types

export interface AssetReviewCheck {
  name: string;
  status: 'ok' | 'warning' | 'error' | string;
  detail: string;
}

export interface AssetReviewEntry {
  layer?: string;
  status?: 'approved_auto' | 'needs_review' | 'attention_needed' | string;
  score?: number;
  summary?: string;
  checks?: AssetReviewCheck[];
  suggestedActions?: string[];
  promptExcerpt?: string;
}

export interface AssetReviewEnvelope {
  version?: number;
  generatedAt?: string;
  layer?: string;
  status?: 'approved_auto' | 'needs_review' | 'attention_needed' | string;
  score?: number;
  summary?: string;
  promptReview?: AssetReviewEntry;
  assetReview?: AssetReviewEntry;
}

export interface TimelineAsset {
  id: string;
  type: 'world' | 'script' | 'keyframe' | 'video' | 'audio';
  startTime: number; // in seconds
  duration: number; // in seconds
  content: AssetContent;
  metadata?: Record<string, any> & {
    review?: AssetReviewEnvelope;
  };
  created_at: string;
}

export interface AssetContent {
  // Script content
  text?: string;
  
  // Image/KeyFrame content
  imageUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  
  // Video content
  videoUrl?: string;
  posterUrl?: string;
  aspectRatio?: string;
  
  // Audio content
  audioUrl?: string;
  waveformData?: number[];
  
  // Common properties
  title?: string;
  description?: string;
}

export interface TimelineTrack {
  id: string;
  type: 'world' | 'script' | 'keyframe' | 'video' | 'audio';
  name: string;
  assets: TimelineAsset[];
  visible: boolean;
  muted?: boolean; // for audio/video tracks
  volume?: number; // 0-1 for audio/video tracks
}

export interface TimelineData {
  tracks: TimelineTrack[];
  duration: number; // total timeline duration in seconds
  currentTime: number; // playhead position in seconds
  zoom: number; // timeline zoom level
  settings: {
    fps: number;
    resolution: {
      width: number;
      height: number;
    };
  };
}

export interface TimelineState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  zoom: number;
  selectedAssets: string[];
  draggedAsset?: {
    assetId: string;
    trackId: string;
    startTime: number;
  };
}

// Chat message to timeline asset conversion types
export interface ChatMessageAsset {
  messageId: string;
  role: 'user' | 'assistant';
  type: 'world' | 'script' | 'keyframe' | 'video' | 'audio';
  content: AssetContent;
  timestamp: string;
}

// Timeline editor configuration
export interface TimelineConfig {
  pixelsPerSecond: number;
  trackHeight: number;
  headerWidth: number;
  rulerHeight: number;
  minZoom: number;
  maxZoom: number;
}

export const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  pixelsPerSecond: 50,
  trackHeight: 80,
  headerWidth: 120,
  rulerHeight: 40,
  minZoom: 0.1,
  maxZoom: 10,
};

// Magnetic snap configuration
export const SNAP_CONFIG = {
  threshold: 0.2, // 0.2 seconds snap threshold
  pixelThreshold: 10, // 10 pixels snap threshold
};

// Magnetic snap utilities
export interface SnapPoint {
  time: number;
  type: 'start' | 'end';
  assetId: string;
  trackId: string;
}

export function calculateSnapPosition(
  draggedAsset: TimelineAsset,
  allAssets: TimelineAsset[],
  newStartTime: number,
  config: TimelineConfig
): { snappedTime: number; isSnapped: boolean } {
  const snapPoints: SnapPoint[] = [];

  // Collect all snap points from other assets
  allAssets.forEach(asset => {
    if (asset.id !== draggedAsset.id) {
      snapPoints.push({
        time: asset.startTime,
        type: 'start',
        assetId: asset.id,
        trackId: asset.type
      });
      snapPoints.push({
        time: asset.startTime + asset.duration,
        type: 'end',
        assetId: asset.id,
        trackId: asset.type
      });
    }
  });

  // Add timeline start point
  snapPoints.push({
    time: 0,
    type: 'start',
    assetId: 'timeline-start',
    trackId: 'timeline'
  });

  // Find closest snap point within threshold
  let closestSnap: SnapPoint | null = null;
  let minDistance = SNAP_CONFIG.threshold;

  snapPoints.forEach(point => {
    const distance = Math.abs(point.time - newStartTime);
    if (distance < minDistance) {
      minDistance = distance;
      closestSnap = point;
    }
  });

  if (closestSnap) {
    return {
      snappedTime: closestSnap.time,
      isSnapped: true
    };
  }

  return {
    snappedTime: newStartTime,
    isSnapped: false
  };
}

// Canvas data types (Excalidraw format)
export interface CanvasFile {
  id: string;
  created: number;
  dataURL: string;
  mimeType: string;
  duration?: number;
  videoType?: string;
  audioType?: string;
  aspectRatio?: string;
  inputImageUrl?: string;
}

export interface CanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fileId?: string;
  isVideo?: boolean;
  isAudio?: boolean;
  videoUrl?: string;
  audioUrl?: string;
  duration?: number;
  aspectRatio?: string;
  inputImageUrl?: string;
  boundToImageId?: string;
  skipMagneticSnap?: boolean;
  created?: number;
  updated?: number;
  status?: string;
}

// Timeline position data stored in canvas
export interface TimelineAssetPosition {
  fileId?: string;
  elementId?: string;
  type: 'world' | 'script' | 'keyframe' | 'video' | 'audio';
  startTime: number;
  duration: number;
  trackId: string;
}

export interface TimelinePositionData {
  assets: TimelineAssetPosition[];
  duration: number;
  lastUpdated?: string;
}

export interface CanvasData {
  files: Record<string, CanvasFile>;
  elements: CanvasElement[];
  appState: any;
  timeline?: TimelinePositionData;
}

// Timeline events
export type TimelineEvent =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; time: number }
  | { type: 'ZOOM'; zoom: number }
  | { type: 'SELECT_ASSET'; assetId: string }
  | { type: 'DESELECT_ALL' }
  | { type: 'MOVE_ASSET'; assetId: string; trackId: string; startTime: number }
  | { type: 'DELETE_ASSET'; assetId: string }
  | { type: 'ADD_ASSET'; asset: TimelineAsset; trackId: string };
