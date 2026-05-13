"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TimelineData,
  TimelineAsset,
  ChatMessageAsset,
  TimelinePositionData,
  TimelineAssetPosition,
} from '@/lib/nolanx/types/timeline';
import { saveCanvas, updateTimelineAssetStartTimes } from '@/lib/nolanx/api/canvas';

export function useTimelineData(canvasId: string, sessionList: any[] = [], canvasData?: any) {
  const [timelineData, setTimelineData] = useState<TimelineData>({
    tracks: [
      {
        id: 'script-track',
        type: 'script',
        name: 'Script',
        assets: [],
        visible: true,
      },
      {
        id: 'world-track',
        type: 'world',
        name: 'World',
        assets: [],
        visible: true,
      },
      {
        id: 'keyframe-track',
        type: 'keyframe',
        name: 'Key Frame',
        assets: [],
        visible: true,
      },
      {
        id: 'video-track',
        type: 'video',
        name: 'Video',
        assets: [],
        visible: true,
      },
      {
        id: 'audio-track',
        type: 'audio',
        name: 'Audio',
        assets: [],
        visible: true,
        muted: false,
        volume: 1,
      },
    ],
    duration: 30,
    currentTime: 0,
    zoom: 1,
    settings: {
      fps: 30,
      resolution: {
        width: 1920,
        height: 1080,
      },
    },
  });

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);

  // 防抖机制防止竞态条件
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isFullTimelinePayload = (timeline: any): boolean => {
    return Boolean(timeline && Array.isArray(timeline.tracks));
  };

  const isPositionTimelinePayload = (timeline: any): boolean => {
    return Boolean(timeline && Array.isArray(timeline.assets));
  };



  // Helper function to extract complete canvas data from nested structure
  const getCompleteCanvasData = useCallback((canvas: any) => {
    if (!canvas) return null;

    // Handle nested data structure - merge all levels (up to 3 levels deep)
    const allElements = [
      ...(canvas.elements || []),
      ...(canvas.data?.elements || []),
      ...(canvas.data?.data?.elements || [])
    ];

    const allFiles = {
      ...(canvas.files || {}),
      ...(canvas.data?.files || {}),
      ...(canvas.data?.data?.files || {})
    };

    const appState = canvas.appState ||
                    canvas.data?.appState ||
                    canvas.data?.data?.appState ||
                    {};

    const timeline = canvas.timeline ||
                    canvas.data?.timeline ||
                    canvas.data?.data?.timeline;

    return {
      elements: allElements,
      files: allFiles,
      appState,
      timeline
    };
  }, []);

  const getCanvasDataPreview = useCallback((canvas: any): string => {
    if (typeof canvas === 'undefined') return '';

    try {
      const serialized = JSON.stringify(canvas);
      return typeof serialized === 'string' ? serialized.slice(0, 100) : '';
    } catch (error) {
      console.warn('⚠️ Failed to serialize canvas data preview:', error);
      return '';
    }
  }, []);

  // Extract assets from canvas data (Excalidraw format)
  const extractAssetsFromCanvasData = useCallback((canvas: any): TimelineAsset[] => {
    const assets: TimelineAsset[] = [];

    if (!canvas) {
      console.log('No canvas data provided');
      return assets;
    }

    console.log('🔍 Raw canvas data structure:', {
      hasTopLevelElements: !!canvas.elements,
      hasTopLevelFiles: !!canvas.files,
      hasNestedData: !!canvas.data,
      hasDoubleNestedData: !!canvas.data?.data,
      topLevelElementsLength: canvas.elements?.length,
      topLevelFilesCount: Object.keys(canvas.files || {}).length,
      nestedElementsLength: canvas.data?.elements?.length,
      nestedFilesCount: Object.keys(canvas.data?.files || {}).length,
      doubleNestedElementsLength: canvas.data?.data?.elements?.length,
      doubleNestedFilesCount: Object.keys(canvas.data?.data?.files || {}).length
    });

    // Use helper function to get complete canvas data
    const completeCanvasData = getCompleteCanvasData(canvas);
    if (!completeCanvasData) {
      console.log('Failed to extract complete canvas data');
      return assets;
    }

    const { elements: allElements, files: allFiles } = completeCanvasData;

    if (!allElements.length || !Object.keys(allFiles).length) {
      console.log('Canvas missing elements or files after merging:', {
        allElementsLength: allElements.length,
        allFilesCount: Object.keys(allFiles).length
      });
      return assets;
    }

    console.log('📊 Merged canvas data:', {
      totalElements: allElements.length,
      totalFiles: Object.keys(allFiles).length,
      elementTypes: allElements.map(e => e.type),
      fileTypes: Object.values(allFiles).map((f: any) => f.mimeType)
    });

    // Process elements and group by type
    const processedElements = new Map<string, any>();
    const processedFiles = new Set<string>();

    // Handle Excalidraw elements
    allElements.forEach((element: any) => {
      console.log('🔍 Processing element:', {
        id: element.id,
        type: element.type,
        fileId: element.fileId,
        isVideo: element.isVideo,
        isAudio: element.isAudio,
        videoUrl: element.videoUrl,
        audioUrl: element.audioUrl
      });

      if (!element.fileId) {
        console.log('⚠️ Skipping element without fileId:', element.id);
        return;
      }

      let key: string;
      let assetType: string;

      // Determine element type based on Excalidraw structure
      if (element.isVideo || element.type === 'video' || (element.type === 'image' && element.videoUrl)) {
        key = `video-${element.fileId}`;
        assetType = 'video';
      } else if (element.isAudio || element.type === 'audio' || (element.type === 'image' && element.audioUrl)) {
        key = `audio-${element.fileId}`;
        assetType = 'audio';
      } else if (element.type === 'image') {
        key = `image-${element.fileId}`;
        assetType = 'keyframe';
      } else {
        console.log('⚠️ Skipping unknown element type:', { type: element.type, id: element.id, fileId: element.fileId });
        return; // Skip unknown types
      }

      if (!processedElements.has(key)) {
        processedElements.set(key, { ...element, assetType });
        processedFiles.add(element.fileId);
        console.log('✅ Added element to processing:', { key, assetType, elementId: element.id });
      } else {
        console.log('⚠️ Duplicate element key, skipping:', { key, elementId: element.id });
      }
    });

    // Also check for standalone files without elements
    Object.entries(allFiles).forEach(([fileId, file]: [string, any]) => {
      if (processedFiles.has(fileId)) return;

      if (file.mimeType?.startsWith('audio/')) {
        const key = `audio-${fileId}`;
        if (!processedElements.has(key)) {
          processedElements.set(key, {
            id: `standalone-audio-${fileId}`,
            fileId,
            type: 'audio',
            assetType: 'audio',
            x: 0,
            y: 0,
            width: 200,
            height: 60,
            created: file.created || Date.now()
          });
        }
      } else if (file.mimeType?.startsWith('video/')) {
        const key = `video-${fileId}`;
        if (!processedElements.has(key)) {
          processedElements.set(key, {
            id: `standalone-video-${fileId}`,
            fileId,
            type: 'video',
            assetType: 'video',
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            created: file.created || Date.now()
          });
        }
      } else if (file.mimeType?.startsWith('image/')) {
        const key = `image-${fileId}`;
        if (!processedElements.has(key)) {
          processedElements.set(key, {
            id: `standalone-image-${fileId}`,
            fileId,
            type: 'image',
            assetType: 'keyframe',
            x: 0,
            y: 0,
            width: 400,
            height: 400,
            created: file.created || Date.now()
          });
        }
      }
    });

    const defaultImageDuration = 8;
    const defaultVideoDuration = 8;
    const defaultAudioDuration = 8;

    // Sort elements by x position (left to right) or creation time
    const sortedElements = Array.from(processedElements.values()).sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return (a.created || 0) - (b.created || 0);
    });

    console.log('Processing canvas elements for timeline:', {
      totalElements: sortedElements.length,
      elementTypes: sortedElements.map(e => ({ id: e.id, type: e.assetType, fileId: e.fileId }))
    });

    // Group elements by asset type for independent lane processing
    const elementsByType: Record<string, typeof sortedElements> = {
      video: [],
      audio: [],
      keyframe: []
    };

    // Track unprocessed elements to prevent data loss
    const unprocessedElements: typeof sortedElements = [];

    sortedElements.forEach((element) => {
      if (element.assetType && elementsByType[element.assetType]) {
        elementsByType[element.assetType].push(element);
      } else {
        // Handle elements that don't match expected types
        console.warn('🚨 Element with unexpected assetType:', {
          id: element.id,
          assetType: element.assetType,
          type: element.type,
          fileId: element.fileId
        });

        // Try to infer the correct type based on element.type or file type
        const file = allFiles[element.fileId];
        if (file) {
          if (file.mimeType?.startsWith('video/') || element.type === 'video') {
            elementsByType.video.push({ ...element, assetType: 'video' });
          } else if (file.mimeType?.startsWith('audio/') || element.type === 'audio') {
            elementsByType.audio.push({ ...element, assetType: 'audio' });
          } else if (file.mimeType?.startsWith('image/') || element.type === 'image') {
            elementsByType.keyframe.push({ ...element, assetType: 'keyframe' });
          } else {
            unprocessedElements.push(element);
          }
        } else {
          unprocessedElements.push(element);
        }
      }
    });

    console.log('🧲 Grouped elements by type for independent lane magnetic snapping:', {
      total: sortedElements.length,
      video: elementsByType.video.length,
      audio: elementsByType.audio.length,
      keyframe: elementsByType.keyframe.length,
      unprocessed: unprocessedElements.length,
      videoElements: elementsByType.video.map(e => ({ id: e.id, x: e.x, fileId: e.fileId, assetType: e.assetType })),
      audioElements: elementsByType.audio.map(e => ({ id: e.id, x: e.x, fileId: e.fileId, assetType: e.assetType })),
      keyframeElements: elementsByType.keyframe.map(e => ({ id: e.id, x: e.x, fileId: e.fileId, assetType: e.assetType })),
      unprocessedElements: unprocessedElements.map(e => ({ id: e.id, x: e.x, fileId: e.fileId, assetType: e.assetType, type: e.type }))
    });

    // Alert if there are unprocessed elements
    if (unprocessedElements.length > 0) {
      console.error('🚨 DATA LOSS WARNING: Some elements could not be processed:', unprocessedElements);
    }

    // Process each element individually, preserving existing timeline positions
    sortedElements.forEach((element) => {
      const file = allFiles[element.fileId];
      if (!file) {
        console.warn('File not found for element:', element.fileId, 'Available files:', Object.keys(allFiles));
        return;
      }

      // Create asset with default position (will be adjusted by applyTimelinePositions later)
      if (element.assetType === 'video') {
        // Video element
        const duration = element.duration || file.duration || defaultVideoDuration;
        assets.push({
          id: `canvas-video-${element.fileId}`,
          type: 'video',
          startTime: 0, // Default position, will be adjusted later
          duration,
          content: {
            videoUrl: element.videoUrl || file.dataURL,
            posterUrl: element.inputImageUrl || file.inputImageUrl || file.dataURL,
            aspectRatio: element.aspectRatio || file.aspectRatio || '16:9',
          },
          metadata: {
            canvasElementId: element.id,
            fileId: element.fileId,
          },
          created_at: new Date(file.created || Date.now()).toISOString(),
        });
      } else if (element.assetType === 'audio') {
        // Audio element
        const duration = element.duration || file.duration || defaultAudioDuration;
        assets.push({
          id: `canvas-audio-${element.fileId}`,
          type: 'audio',
          startTime: 0, // Default position, will be adjusted later
          duration,
          content: {
            audioUrl: element.audioUrl || file.dataURL,
            waveformData: [],
          },
          metadata: {
            canvasElementId: element.id,
            fileId: element.fileId,
            audioType: element.audioType || file.audioType,
          },
          created_at: new Date(file.created || Date.now()).toISOString(),
        });
      } else if (element.assetType === 'keyframe') {
        // Image element (keyframe)
        assets.push({
          id: `canvas-keyframe-${element.fileId}`,
          type: 'keyframe',
          startTime: 0, // Default position, will be adjusted later
          duration: defaultImageDuration,
          content: {
            imageUrl: file.dataURL,
            thumbnailUrl: file.dataURL,
            width: element.width || 1024,
            height: element.height || 1024,
          },
          metadata: {
            canvasElementId: element.id,
            fileId: element.fileId,
          },
          created_at: new Date(file.created || Date.now()).toISOString(),
        });
      }
    });

    console.log('✅ Extracted timeline assets from canvas:', {
      total: assets.length,
      byType: {
        video: assets.filter(a => a.type === 'video').length,
        audio: assets.filter(a => a.type === 'audio').length,
        keyframe: assets.filter(a => a.type === 'keyframe').length,
      },
      assets: assets.map(a => ({
        id: a.id,
        type: a.type,
        fileId: a.metadata?.fileId,
        startTime: a.startTime,
        duration: a.duration
      }))
    });

    return assets;
  }, [getCompleteCanvasData]);

  // Apply magnetic snapping to assets within each lane independently (0 gap)
  const applyLaneMagneticSnapping = useCallback((assets: TimelineAsset[]): TimelineAsset[] => {
    console.log('🧲 Starting lane magnetic snapping with assets:', {
      total: assets.length,
      assets: assets.map(a => ({ id: a.id, type: a.type, fileId: a.metadata?.fileId, startTime: a.startTime }))
    });

    // Group assets by type (lane)
    const assetsByType = assets.reduce((acc, asset) => {
      if (!acc[asset.type]) acc[asset.type] = [];
      acc[asset.type].push(asset);
      return acc;
    }, {} as Record<string, TimelineAsset[]>);

    const rearrangedAssets: TimelineAsset[] = [];

    // Process each lane independently
    Object.entries(assetsByType).forEach(([type, laneAssets]) => {
      if (laneAssets.length === 0) return;

      console.log(`🧲 Applying magnetic snapping to ${type} lane with ${laneAssets.length} assets (0 gap)`);

      // Sort assets by their creation time (preserve order of addition)
      const sortedAssets = [...laneAssets].sort((a, b) => {
        return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
      });

      // Apply magnetic snapping: each asset snaps to the end of the previous one (0 time gap)
      let currentTime = 0;
      sortedAssets.forEach((asset, index) => {
        const rearrangedAsset = {
          ...asset,
          startTime: currentTime
        };
        rearrangedAssets.push(rearrangedAsset);
        // 磁吸：下一个资产的开始时间 = 当前资产的结束时间（0时间差）
        currentTime += asset.duration;

        console.log(`🧲 ${type} asset ${index + 1}/${sortedAssets.length} positioned at time ${rearrangedAsset.startTime} (magnetic snap, 0 gap)`);
      });

      console.log(`✅ Completed magnetic snapping for ${type} lane. Final time: ${currentTime}`);
    });

    console.log('🧲 Finished lane magnetic snapping:', {
      input: assets.length,
      output: rearrangedAssets.length
    });

    return rearrangedAssets;
  }, []);

  // Append new assets to existing timeline tracks
  const appendAssetsToExistingTimeline = useCallback((allAssets: TimelineAsset[], existingTimelineData: TimelineData): TimelineAsset[] => {
    console.log('🧲 Appending assets to existing timeline:', {
      allAssets: allAssets.length,
      existingTracks: existingTimelineData.tracks.length
    });

    // 从现有时间线数据中提取所有现有资产
    const existingAssets: TimelineAsset[] = [];
    const existingAssetIds = new Set<string>();
    const existingFileIds = new Set<string>();

    existingTimelineData.tracks.forEach(track => {
      if (track.assets && track.assets.length > 0) {
        track.assets.forEach(asset => {
          existingAssets.push(asset);
          existingAssetIds.add(asset.id);
          if (asset.metadata?.fileId) {
            existingFileIds.add(asset.metadata.fileId);
          }
        });
      }
    });

    console.log('🧲 Found existing assets:', {
      count: existingAssets.length,
      ids: Array.from(existingAssetIds),
      fileIds: Array.from(existingFileIds)
    });

    // 分离真正的新资产和现有资产
    const reallyNewAssets: TimelineAsset[] = [];
    const preservedExistingAssets: TimelineAsset[] = [];

    allAssets.forEach(asset => {
      const fileId = asset.metadata?.fileId;
      const assetId = asset.id;

      // 检查是否是现有资产（通过fileId或assetId）
      const isExisting = existingAssetIds.has(assetId) || (fileId && existingFileIds.has(fileId));

      if (isExisting) {
        // 找到对应的现有资产，保持其位置
        const existingAsset = existingAssets.find(ea =>
          ea.id === assetId || (ea.metadata?.fileId && ea.metadata.fileId === fileId)
        );
        if (existingAsset) {
          preservedExistingAssets.push(existingAsset);
          console.log(`🧲 Preserved existing ${existingAsset.type} asset at time ${existingAsset.startTime}`);
        }
      } else {
        reallyNewAssets.push(asset);
        console.log(`🧲 Identified new ${asset.type} asset: ${asset.id}`);
      }
    });

    console.log('🧲 Asset classification:', {
      preserved: preservedExistingAssets.length,
      reallyNew: reallyNewAssets.length
    });

    // 如果没有真正的新资产，直接返回现有资产
    if (reallyNewAssets.length === 0) {
      console.log('🧲 No new assets found, returning existing assets');
      return preservedExistingAssets;
    }

    // 计算每个lane的结束时间（基于保留的现有资产）
    const laneEndTimes: Record<string, number> = {};
    preservedExistingAssets.forEach(asset => {
      const endTime = asset.startTime + asset.duration;
      if (!laneEndTimes[asset.type] || endTime > laneEndTimes[asset.type]) {
        laneEndTimes[asset.type] = endTime;
      }
    });

    console.log('🧲 Lane end times based on existing assets:', laneEndTimes);

    // 将新资产按类型分组
    const newAssetsByType = reallyNewAssets.reduce((acc, asset) => {
      if (!acc[asset.type]) acc[asset.type] = [];
      acc[asset.type].push(asset);
      return acc;
    }, {} as Record<string, TimelineAsset[]>);

    // 为每个类型的新资产设置位置
    const positionedNewAssets: TimelineAsset[] = [];
    Object.entries(newAssetsByType).forEach(([type, typeAssets]) => {
      let currentTime = laneEndTimes[type] || 0;

      // 按创建时间排序
      const sortedAssets = [...typeAssets].sort((a, b) => {
        return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
      });

      sortedAssets.forEach((asset, index) => {
        const positionedAsset = {
          ...asset,
          startTime: currentTime
        };
        positionedNewAssets.push(positionedAsset);
        currentTime += asset.duration;

        console.log(`🧲 New ${type} asset ${index + 1}/${sortedAssets.length} positioned at time ${positionedAsset.startTime} (after existing assets)`);
      });
    });

    // 返回保留的现有资产 + 新定位的资产
    const finalAssets = [...preservedExistingAssets, ...positionedNewAssets];
    console.log('🧲 Total assets after appending:', {
      preserved: preservedExistingAssets.length,
      new: positionedNewAssets.length,
      total: finalAssets.length
    });

    return finalAssets;
  }, []);

  // Apply saved timeline positions to assets
  const applyTimelinePositions = useCallback((assets: TimelineAsset[], timelineData?: TimelinePositionData, existingTimelineData?: TimelineData): TimelineAsset[] => {
    console.log('🧲 Applying timeline positions:', {
      assetsCount: assets.length,
      hasSavedPositions: !!(timelineData?.assets && timelineData.assets.length > 0),
      hasExistingTimeline: !!(existingTimelineData?.tracks && existingTimelineData.tracks.length > 0),
      savedPositionsCount: timelineData?.assets?.length || 0
    });

    if (!timelineData?.assets || timelineData.assets.length === 0) {
      // 如果没有保存的位置数据，但有现有的时间线数据，则基于现有数据进行磁吸
      if (existingTimelineData?.tracks && existingTimelineData.tracks.length > 0) {
        console.log('🧲 No saved positions but has existing timeline, appending new assets to existing tracks');
        return appendAssetsToExistingTimeline(assets, existingTimelineData);
      } else {
        // 完全没有时间线数据，从0开始磁吸
        console.log('🧲 No saved positions and no existing timeline, applying lane magnetic snapping from 0');
        return applyLaneMagneticSnapping(assets);
      }
    }

    const positionMap = new Map<string, TimelineAssetPosition>();
    timelineData.assets.forEach(pos => {
      const key = pos.fileId || pos.elementId || '';
      if (key) {
        positionMap.set(key, pos);
      }
    });

    const assetsWithSavedPositions: TimelineAsset[] = [];
    const newAssets: TimelineAsset[] = [];

    // Separate assets with saved positions from new assets
    assets.forEach(asset => {
      const fileId = asset.metadata?.fileId;
      const elementId = asset.metadata?.canvasElementId;
      const key = fileId || elementId || '';

      if (key && positionMap.has(key)) {
        const position = positionMap.get(key)!;
        assetsWithSavedPositions.push({
          ...asset,
          startTime: position.startTime,
          duration: position.duration,
        });
      } else {
        newAssets.push(asset);
      }
    });

    // For new assets, position them at the end of their respective lanes
    const processedNewAssets: TimelineAsset[] = [];
    if (newAssets.length > 0) {
      console.log('🧲 Processing new assets:', {
        newAssetsCount: newAssets.length,
        existingAssetsCount: assetsWithSavedPositions.length,
        newAssets: newAssets.map(a => ({ id: a.id, type: a.type, fileId: a.metadata?.fileId }))
      });

      // Group existing assets by type to find the end time for each lane
      const existingAssetsByType = assetsWithSavedPositions.reduce((acc, asset) => {
        if (!acc[asset.type]) acc[asset.type] = [];
        acc[asset.type].push(asset);
        return acc;
      }, {} as Record<string, TimelineAsset[]>);

      // Calculate the end time for each lane based on existing assets
      const laneEndTimes: Record<string, number> = {};
      Object.entries(existingAssetsByType).forEach(([type, assets]) => {
        if (assets.length > 0) {
          laneEndTimes[type] = Math.max(...assets.map(asset => asset.startTime + asset.duration));
          console.log(`🧲 Lane ${type} has existing assets, end time: ${laneEndTimes[type]}`);
        } else {
          laneEndTimes[type] = 0;
          console.log(`🧲 Lane ${type} is empty, starting from 0`);
        }
      });

      console.log('🧲 Lane end times for new assets:', laneEndTimes);

      // Group new assets by type for proper ordering
      const newAssetsByType = newAssets.reduce((acc, asset) => {
        if (!acc[asset.type]) acc[asset.type] = [];
        acc[asset.type].push(asset);
        return acc;
      }, {} as Record<string, TimelineAsset[]>);

      // Process new assets by type, maintaining order within each type
      Object.entries(newAssetsByType).forEach(([type, typeAssets]) => {
        let currentLaneTime = laneEndTimes[type] || 0;

        // Sort new assets of this type by creation time
        const sortedTypeAssets = [...typeAssets].sort((a, b) => {
          return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
        });

        sortedTypeAssets.forEach((asset, index) => {
          const positionedAsset = {
            ...asset,
            startTime: currentLaneTime
          };

          // Update the lane time for the next asset (magnetic snapping with 0 gap)
          currentLaneTime += asset.duration;

          processedNewAssets.push(positionedAsset);
          console.log(`🧲 New ${asset.type} asset ${index + 1}/${sortedTypeAssets.length} positioned at time ${positionedAsset.startTime} (magnetic snap after existing assets)`);
        });
      });
    }

    const allAssets = [...assetsWithSavedPositions, ...processedNewAssets];

    console.log('🧲 Applied timeline positions:', {
      withSavedPositions: assetsWithSavedPositions.length,
      newAssets: processedNewAssets.length,
      total: allAssets.length
    });

    return allAssets;
  }, [applyLaneMagneticSnapping]);

  // Convert chat messages to timeline assets
  const extractAssetsFromChatSessions = useCallback((sessions: any[]): ChatMessageAsset[] => {
    const assets: ChatMessageAsset[] = [];

    sessions.forEach(session => {
      if (!session.messages) return;

      session.messages.forEach((message: any) => {
        const hasTextContent = typeof message.content === 'string';
        const hasArrayContent = Array.isArray(message.content);
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        const hasToolResults = Array.isArray(message.tool_results) && message.tool_results.length > 0;

        // Nothing to extract from this message
        if (!hasTextContent && !hasArrayContent && !hasToolCalls && !hasToolResults) return;

        // Extract text content (script) - ignore whitespace-only and tool-call placeholders
        if (hasTextContent && message.role === 'assistant') {
          const trimmed = String(message.content).trim();
          if (trimmed && !hasToolCalls) {
            assets.push({
              messageId: message.id,
              role: message.role,
              type: 'script',
              content: {
                text: message.content,
              },
              timestamp: message.created_at || new Date().toISOString(),
            });
          }
        }

        // Extract image content (keyframes)
        if (hasArrayContent) {
          message.content.forEach((item: any) => {
            if (item.type === 'image_url' && item.image_url?.url) {
              assets.push({
                messageId: message.id,
                role: message.role,
                type: 'keyframe',
                content: {
                  imageUrl: item.image_url.url,
                  thumbnailUrl: item.image_url.url,
                  width: 1024,
                  height: 1024,
                },
                timestamp: message.created_at || new Date().toISOString(),
              });
            }
          });
        }

        // Extract tool calls for video and audio
        if (message.tool_calls) {
          message.tool_calls.forEach((toolCall: any) => {
            let args: any = {}
            try {
              args = JSON.parse(toolCall.function.arguments || '{}')
            } catch {
              args = {}
            }
            
            if (toolCall.function.name === 'generate_video') {
              assets.push({
                messageId: message.id,
                role: message.role,
                type: 'video',
                content: {
                  videoUrl: args.video_url || '',
                  posterUrl: args.poster_url || args.input_image_url || '',
                  aspectRatio: args.aspect_ratio || '16:9',
                },
                timestamp: message.created_at || new Date().toISOString(),
              });
            }

            if (toolCall.function.name === 'generate_audio') {
              assets.push({
                messageId: message.id,
                role: message.role,
                type: 'audio',
                content: {
                  audioUrl: args.audio_url || '',
                },
                timestamp: message.created_at || new Date().toISOString(),
              });
            }
          });
        }

        // Extract tool results
        if (message.tool_results) {
          message.tool_results.forEach((result: any) => {
            try {
              const resultData = JSON.parse(result.content || '{}');
              
              if (resultData.video_url) {
                assets.push({
                  messageId: message.id,
                  role: message.role,
                  type: 'video',
                  content: {
                    videoUrl: resultData.video_url,
                    posterUrl: resultData.poster_url || resultData.input_image_url || '',
                    aspectRatio: resultData.aspect_ratio || '16:9',
                  },
                  timestamp: message.created_at || new Date().toISOString(),
                });
              }

              if (resultData.audio_url) {
                assets.push({
                  messageId: message.id,
                  role: message.role,
                  type: 'audio',
                  content: {
                    audioUrl: resultData.audio_url,
                  },
                  timestamp: message.created_at || new Date().toISOString(),
                });
              }
            } catch (e) {
              // Ignore parsing errors
            }
          });
        }
      });
    });

    return assets;
  }, []);

  // Convert chat assets to timeline assets with improved sequencing
  const convertToTimelineAssets = useCallback((chatAssets: ChatMessageAsset[]): TimelineAsset[] => {
    // Sort chat assets by timestamp first
    const sortedAssets = [...chatAssets].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Group by type for better timeline organization
    const assetsByType = sortedAssets.reduce((acc, asset) => {
      if (!acc[asset.type]) acc[asset.type] = [];
      acc[asset.type].push(asset);
      return acc;
    }, {} as Record<string, ChatMessageAsset[]>);

    const timelineAssets: TimelineAsset[] = [];

    // Process each type independently with magnetic snapping (0 gap)
    const typeOrder: Array<keyof typeof assetsByType> = ['script', 'keyframe', 'video', 'audio'];

    typeOrder.forEach(type => {
      if (assetsByType[type]) {
        let laneCurrentTime = 0; // Each lane starts from 0 independently

        console.log(`🧲 Processing chat ${type} assets with magnetic snapping (0 gap)`);

        assetsByType[type].forEach((chatAsset, index) => {
          const duration = chatAsset.type === 'script' ?
            Math.max(3, (chatAsset.content.text?.length || 0) / 20) : // Estimate reading time
            chatAsset.type === 'audio' ? 10 : // Default audio duration
            5; // Default for images and videos

          const asset: TimelineAsset = {
            id: `${chatAsset.messageId}-${chatAsset.type}-${index}`,
            type: chatAsset.type,
            startTime: laneCurrentTime,
            duration,
            content: chatAsset.content,
            metadata: {
              messageId: chatAsset.messageId,
              role: chatAsset.role,
            },
            created_at: chatAsset.timestamp,
          };

          timelineAssets.push(asset);
          // 磁吸：下一个资产的开始时间 = 当前资产的结束时间（0时间差）
          laneCurrentTime += duration;

          console.log(`🧲 Chat ${type} asset ${index + 1} positioned at time ${asset.startTime} (magnetic snap, 0 gap)`);
        });

        console.log(`✅ Completed chat ${type} lane processing. Final time: ${laneCurrentTime} (magnetic snapping)`);
      }
    });

    return timelineAssets;
  }, []);

  // Compare timeline data for incremental updates
  const compareTimelineData = useCallback((
    newAssets: TimelineAsset[],
    currentTimelineData: TimelineData | null
  ): { hasChanges: boolean; newAssets: TimelineAsset[]; changedAssets: TimelineAsset[] } => {
    if (!currentTimelineData) {
      return { hasChanges: true, newAssets, changedAssets: [] };
    }

    // Get current assets from timeline
    const currentAssets = currentTimelineData.tracks.flatMap(track => track.assets);
    const currentAssetMap = new Map(currentAssets.map(asset => [asset.id, asset]));

    const newAssetsList: TimelineAsset[] = [];
    const changedAssetsList: TimelineAsset[] = [];

    // Check for new or changed assets
    for (const newAsset of newAssets) {
      const currentAsset = currentAssetMap.get(newAsset.id);

      if (!currentAsset) {
        // New asset
        newAssetsList.push(newAsset);
      } else {
        // Check if asset has changed
        const hasChanged =
          currentAsset.startTime !== newAsset.startTime ||
          currentAsset.duration !== newAsset.duration ||
          JSON.stringify(currentAsset.content) !== JSON.stringify(newAsset.content) ||
          JSON.stringify(currentAsset.metadata || {}) !== JSON.stringify(newAsset.metadata || {});

        if (hasChanged) {
          changedAssetsList.push(newAsset);
        }
      }
    }

    const hasChanges = newAssetsList.length > 0 || changedAssetsList.length > 0 ||
                      currentAssets.length !== newAssets.length;

    return { hasChanges, newAssets: newAssetsList, changedAssets: changedAssetsList };
  }, []);

  // Update asset startTimes in database via reelmind.server API
  const updateAssetStartTimes = useCallback(async (assets: TimelineAsset[]) => {
    if (!canvasId || assets.length === 0) return;

    try {
      console.log('🔄 Updating asset startTimes via API:', assets.length);

      // Prepare updates for API call
      const updates = assets.map(asset => ({
        id: asset.id,
        startTime: asset.startTime || 0
      }));

      // Call reelmind.server user API to update startTimes
      const result = await updateTimelineAssetStartTimes(canvasId, updates);
      console.log('✅ Asset startTimes updated successfully via user API:', result);
    } catch (error) {
      console.error('❌ Failed to update asset startTimes via API:', error);

      // Fallback to direct canvas data update
      try {
        console.log('🔄 Falling back to direct canvas update...');

        // Get current canvas data
        const completeCanvasData = getCompleteCanvasData(canvasData);
        if (!completeCanvasData?.timeline) {
          console.warn('⚠️ No timeline data found for startTime update');
          return;
        }

        // Update timeline data with new startTimes
        const updatedTimeline = { ...completeCanvasData.timeline };

        // Update each track's assets
        updatedTimeline.tracks = updatedTimeline.tracks.map((track: any) => {
          const updatedAssets = track.assets.map((asset: any) => {
            const updatedAsset = assets.find(a => a.id === asset.id);
            if (updatedAsset) {
              return { ...asset, startTime: updatedAsset.startTime };
            }
            return asset;
          });

          return { ...track, assets: updatedAssets };
        });

        // Save updated timeline data
        const updatedCanvasData = {
          elements: completeCanvasData.elements,
          appState: completeCanvasData.appState,
          files: completeCanvasData.files,
          timeline: updatedTimeline,
        };

        await saveCanvas(canvasId, {
          data: updatedCanvasData as any,
          thumbnail: '',
        });

        console.log('✅ Asset startTimes updated successfully via fallback');
      } catch (fallbackError) {
        console.error('❌ Fallback update also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }, [canvasId, canvasData, getCompleteCanvasData]);

  // Load timeline data with debouncing
  useEffect(() => {
    // 创建更精确的数据指纹，优先检查timeline数据
    const completeCanvasData = getCompleteCanvasData(canvasData);
    const timelineLastUpdated = completeCanvasData?.timeline?.lastUpdated;
    const timelineAssetCount = completeCanvasData?.timeline?.tracks?.reduce((total: number, track: any) =>
      total + (track.assets?.length || 0), 0) || 0;

    const dataFingerprint = {
      timelineLastUpdated,
      timelineAssetCount,
      sessionListLength: sessionList?.length || 0,
      refreshTrigger,
      // 只在没有timeline数据时才包含完整canvas数据的hash
      canvasDataHash: !completeCanvasData?.timeline ?
        getCanvasDataPreview(canvasData) : null
    };

    const dataHash = JSON.stringify(dataFingerprint);

    // 如果数据没有变化，跳过处理
    if (lastProcessedDataRef.current === dataHash) {
      console.log('🔄 Timeline data unchanged, skipping update', {
        timelineLastUpdated,
        timelineAssetCount,
        hasDirectTimeline: !!completeCanvasData?.timeline
      });
      return;
    }

    // 清除之前的超时
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
    }

    // 设置防抖延迟
    processingTimeoutRef.current = setTimeout(() => {
      console.log('🔄 Processing timeline data update (debounced)', {
        timelineLastUpdated,
        timelineAssetCount,
        hasDirectTimeline: !!completeCanvasData?.timeline
      });
      lastProcessedDataRef.current = dataHash;

      const loadTimelineData = async () => {
        console.log('🔄 Loading timeline data...', {
          canvasId,
          hasCanvasData: !!canvasData,
          sessionListLength: sessionList.length,
          refreshTrigger
        });

        // 不在开始时设置loading，只在有变化时设置
        // setIsLoading(true);

      try {
        let timelineAssets: TimelineAsset[] = [];

        // First, check if we have direct timeline data from canvas (full timeline payload with tracks)
        const completeCanvasData = getCompleteCanvasData(canvasData);
        const canvasTimeline = completeCanvasData?.timeline;
        if (isFullTimelinePayload(canvasTimeline)) {
          console.log('📊 Found full timeline data in canvas:', canvasTimeline);

          // Extract assets from timeline tracks
          canvasTimeline.tracks.forEach((track: any) => {
            if (track.assets && Array.isArray(track.assets)) {
              timelineAssets.push(...track.assets);
            }
          });

          console.log('📊 Extracted timeline assets:', {
            total: timelineAssets.length,
            byType: timelineAssets.reduce((acc, asset) => {
              acc[asset.type] = (acc[asset.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          });
        } else {
          // Fallback: Extract assets from legacy canvas data and chat sessions
          console.log('📊 No direct timeline data found, using legacy extraction...');

          // Extract assets from canvas data (legacy)
          let canvasAssets: TimelineAsset[] = [];
          if (canvasData) {
            canvasAssets = extractAssetsFromCanvasData(canvasData);
            console.log('📊 Extracted legacy canvas assets:', {
              total: canvasAssets.length,
              byType: canvasAssets.reduce((acc, asset) => {
                acc[asset.type] = (acc[asset.type] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            });
          }

          // Extract assets from chat sessions
          let chatAssets: TimelineAsset[] = [];
          if (sessionList && sessionList.length > 0) {
            const chatMessageAssets = extractAssetsFromChatSessions(sessionList);
            chatAssets = convertToTimelineAssets(chatMessageAssets);
            console.log('💬 Extracted chat assets:', {
              total: chatAssets.length,
              byType: chatAssets.reduce((acc, asset) => {
                acc[asset.type] = (acc[asset.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
            });
          }

          // Merge canvas and chat assets for legacy mode
          timelineAssets = [...canvasAssets, ...chatAssets];
        }

        // Remove duplicates based on asset ID
        const uniqueAssets = new Map<string, TimelineAsset>();

        timelineAssets.forEach(asset => {
          uniqueAssets.set(asset.id, asset);
        });

        timelineAssets = Array.from(uniqueAssets.values());

        // Guard: drop legacy/placeholder script assets that render as empty blocks (e.g. whitespace-only chat artifacts)
        timelineAssets = timelineAssets.filter(asset => {
          if (asset.type !== 'script') return true;

          const text = typeof asset.content?.text === 'string' ? asset.content.text : '';
          const isBlank = text.trim().length === 0;
          if (!isBlank) return true;

          // Chat-derived empty text blocks (common source of a mysterious empty ~5s script clip)
          if (asset.metadata?.messageId) return false;

          const title = typeof asset.content?.title === 'string' ? asset.content.title.trim() : '';
          const kind = String(asset.metadata?.kind || '').trim();
          const startTime = typeof asset.startTime === 'number' ? asset.startTime : 0;
          const duration = typeof asset.duration === 'number' ? asset.duration : 0;

          // Conservative fallback: only remove truly-untitled, short, timeline-start placeholders.
          if (!title && !kind && startTime === 0 && duration > 0 && duration <= 6) return false;

          return true;
        });

        // Incremental comparison to optimize updates
        const comparison = compareTimelineData(timelineAssets, timelineData);

        if (!comparison.hasChanges) {
          console.log('🔄 No timeline changes detected, skipping update');
          // 不需要设置loading为false，因为没有变化就不应该有loading状态
          return;
        }

        console.log('🔄 Timeline changes detected:', {
          newAssets: comparison.newAssets.length,
          changedAssets: comparison.changedAssets.length,
          totalAssets: timelineAssets.length
        });

        // Smart startTime calculation - prioritize new assets
        const assetsNeedingStartTime: TimelineAsset[] = [];
        const assetsByTrack = new Map<string, TimelineAsset[]>();

        // Group assets by track type for more accurate positioning
        timelineAssets.forEach(asset => {
          const trackKey = asset.type;
          if (!assetsByTrack.has(trackKey)) {
            assetsByTrack.set(trackKey, []);
          }
          assetsByTrack.get(trackKey)!.push(asset);

          const needsStartTime = asset.startTime === null || asset.startTime === undefined;

          // Only calculate startTime if it is missing; if backend already provided an explicit
          // startTime (e.g. for storyboard alignment), preserve it even for new assets.
          if (needsStartTime) {
            assetsNeedingStartTime.push(asset);
          }
        });

        // Calculate and update startTime for assets that need it
        if (assetsNeedingStartTime.length > 0) {
          console.log('🔄 Smart startTime calculation for assets:', {
            total: assetsNeedingStartTime.length,
            byType: assetsNeedingStartTime.reduce((acc, asset) => {
              acc[asset.type] = (acc[asset.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          });

          for (const asset of assetsNeedingStartTime) {
            const trackAssets = assetsByTrack.get(asset.type) || [];

            // Get assets with valid startTime, sorted by startTime
            const positionedAssets = trackAssets
              .filter(a => a.startTime !== null && a.startTime !== undefined && a.id !== asset.id)
              .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

            let calculatedStartTime = 0;

            if (positionedAssets.length > 0) {
              // Find the next available position after the last asset
              const lastAsset = positionedAssets[positionedAssets.length - 1];
              calculatedStartTime = (lastAsset.startTime || 0) + (lastAsset.duration || 0);

              // Add a small gap between assets (0.1 seconds)
              calculatedStartTime += 0.1;
            }

            // Update asset startTime
            asset.startTime = calculatedStartTime;

            console.log(`🔄 Calculated startTime for ${asset.type} asset ${asset.id}: ${calculatedStartTime}s`);
          }

          // Batch update database with calculated startTimes
          try {
            await updateAssetStartTimes(assetsNeedingStartTime);
          } catch (error) {
            console.error('❌ Failed to update asset startTimes:', error);
            // Don't throw error, continue with local timeline display
          }
        }

        console.log('🔄 Final timeline assets:', {
          total: timelineAssets.length,
          byType: timelineAssets.reduce((acc, asset) => {
            acc[asset.type] = (acc[asset.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        });

        // Apply saved timeline positions (legacy position-only payload), but never reflow "full timeline" payloads
        if (timelineAssets.length > 0 && !isFullTimelinePayload(canvasTimeline)) {
          if (isPositionTimelinePayload(canvasTimeline)) {
            console.log('🔄 Applying saved timeline positions to merged assets');
            timelineAssets = applyTimelinePositions(timelineAssets, canvasTimeline, timelineData);
          } else {
            console.log('🔄 No saved positions, applying to existing timeline');
            timelineAssets = applyTimelinePositions(timelineAssets, undefined, timelineData);
          }
        }

        // No demo data - keep timeline empty if no assets found

        // Group assets by type
        const assetsByType = timelineAssets.reduce((acc, asset) => {
          if (!acc[asset.type]) acc[asset.type] = [];
          acc[asset.type].push(asset);
          return acc;
        }, {} as Record<string, TimelineAsset[]>);

        // Calculate total duration based on the rightmost asset's end time across all tracks
        let maxEndTime = 0;

        // Check all tracks for the rightmost asset
        Object.values(assetsByType).forEach(assets => {
          if (assets && assets.length > 0) {
            const trackMaxEndTime = Math.max(...assets.map(asset => asset.startTime + asset.duration));
            maxEndTime = Math.max(maxEndTime, trackMaxEndTime);
          }
        });

        // Minimum 10 seconds, use actual rightmost asset end time
        const totalDuration = Math.max(10, maxEndTime);

        console.log('📏 Timeline duration calculation:', {
          maxEndTime,
          totalDuration,
          assetCounts: Object.entries(assetsByType).map(([type, assets]) => ({
            type,
            count: assets?.length || 0,
            maxEndTime: assets?.length ? Math.max(...assets.map(asset => asset.startTime + asset.duration)) : 0
          }))
        });

        // Optimized timeline update - only update changed tracks
        setTimelineData(prev => {
          const updatedTracks = prev.tracks.map(track => {
            const newAssets = assetsByType[track.type] || [];
            const currentAssets = track.assets || [];

            // Check if track has changes
            const hasTrackChanges =
              newAssets.length !== currentAssets.length ||
              newAssets.some(newAsset =>
                !currentAssets.find(currentAsset =>
                  currentAsset.id === newAsset.id &&
                  currentAsset.startTime === newAsset.startTime &&
                  currentAsset.duration === newAsset.duration
                )
              );

            if (hasTrackChanges) {
              console.log(`🔄 Updating ${track.name} track: ${newAssets.length} assets`);
              return {
                ...track,
                assets: newAssets.sort((a, b) => (a.startTime || 0) - (b.startTime || 0)),
              };
            }

            return track;
          });

          return {
            ...prev,
            tracks: updatedTracks,
            duration: totalDuration,
          };
        });

      } catch (error) {
        console.error('Failed to load timeline data:', error);
      }
      };

      loadTimelineData();
    }, 300); // 300ms防抖延迟

    // 清理函数
    return () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, [sessionList, canvasData, refreshTrigger, extractAssetsFromChatSessions, extractAssetsFromCanvasData, convertToTimelineAssets, applyTimelinePositions, getCanvasDataPreview]);

  // 清理所有超时的useEffect
  useEffect(() => {
    return () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Save timeline positions to canvas data with debouncing
  const saveTimelinePositions = useCallback(async (data: TimelineData, immediate = false) => {
    // 清除之前的保存超时
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const performSave = async () => {
      try {
        setIsSaving(true);
        console.log('💾 Saving timeline positions...', {
          hasCanvasData: !!canvasData,
          tracksCount: data.tracks.length,
          assetsCount: data.tracks.reduce((sum, track) => sum + track.assets.length, 0),
          duration: data.duration,
          immediate
        });

      const timelinePositions: TimelinePositionData = {
        assets: data.tracks.flatMap(track =>
          track.assets.map(asset => ({
            fileId: asset.metadata?.fileId,
            elementId: asset.metadata?.canvasElementId,
            type: asset.type,
            startTime: asset.startTime,
            duration: asset.duration,
            trackId: track.id,
          }))
        ),
        duration: data.duration,
        lastUpdated: new Date().toISOString(),
      };

      // Use helper function to get complete canvas data
      const completeCanvasData = getCompleteCanvasData(canvasData);

      if (!completeCanvasData) {
        console.warn('⚠️ No complete canvas data available, creating minimal structure');
        const updatedCanvasData = {
          elements: [],
          appState: {},
          files: {},
          timeline: timelinePositions,
        };

        await saveCanvas(canvasId, {
          data: updatedCanvasData as any,
          thumbnail: '',
        });
        setLastSaveTime(new Date());
        console.log('✅ Timeline positions saved with minimal structure');
        return;
      }

      const { elements: allElements, files: allFiles, appState, timeline: existingTimeline } = completeCanvasData;

      // Create updated canvas data with preserved existing data
      const updatedCanvasData = {
        elements: allElements,
        appState: appState,
        files: allFiles,
        timeline: {
          ...existingTimeline, // Preserve existing timeline settings
          ...timelinePositions, // Override with new positions
        },
      };

      await saveCanvas(canvasId, {
        data: updatedCanvasData as any,
        thumbnail: '',
      });

        setLastSaveTime(new Date());
        console.log('✅ Timeline positions saved successfully');
      } catch (error) {
        console.error('❌ Failed to save timeline positions:', error);
      } finally {
        setIsSaving(false);
      }
    };

    if (immediate) {
      // 立即保存
      await performSave();
    } else {
      // 防抖保存
      saveTimeoutRef.current = setTimeout(() => {
        performSave();
      }, 500); // 500ms防抖延迟
    }
  }, [canvasId, canvasData, getCompleteCanvasData]);

  // Simple move asset function (keeping for compatibility)
  const moveAssetWithSnap = useCallback((assetId: string, trackId: string, newStartTime: number) => {
    // This function is kept for compatibility but not used in the new direct move approach
    console.log('moveAssetWithSnap (legacy) called:', { assetId, trackId, newStartTime });
  }, []);

  // Add new asset to track with automatic positioning
  const addAssetToTrack = useCallback((trackId: string, asset: Omit<TimelineAsset, 'id' | 'startTime'>) => {
    updateTimelineData(prev => {
      const newData = { ...prev };
      const targetTrack = newData.tracks.find(t => t.id === trackId);

      if (!targetTrack) {
        console.log('❌ Target track not found:', trackId);
        return prev;
      }

      // Calculate automatic start time - position after the last asset
      let startTime = 0;
      if (targetTrack.assets.length > 0) {
        const lastAsset = targetTrack.assets.reduce((latest, current) =>
          (current.startTime + current.duration) > (latest.startTime + latest.duration) ? current : latest
        );
        startTime = lastAsset.startTime + lastAsset.duration;
      }

      // Create new asset with auto-generated ID and calculated start time
      const newAsset: TimelineAsset = {
        ...asset,
        id: `${trackId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        startTime,
      };

      // Add to track and sort
      targetTrack.assets.push(newAsset);
      targetTrack.assets.sort((a, b) => a.startTime - b.startTime);

      console.log('✅ Asset added to track:', trackId, 'at time:', startTime);
      return newData;
    });
  }, []);

  // Update timeline data with immediate save and duration recalculation
  const updateTimelineData = useCallback((updater: (prev: TimelineData) => TimelineData) => {
    setTimelineData(prev => {
      const newData = updater(prev);

      // Recalculate duration after asset movement
      let maxEndTime = 0;
      newData.tracks.forEach(track => {
        if (track.assets && track.assets.length > 0) {
          const trackMaxEndTime = Math.max(...track.assets.map(asset => asset.startTime + asset.duration));
          maxEndTime = Math.max(maxEndTime, trackMaxEndTime);
        }
      });

      // Update duration with recalculated value
      const updatedDuration = Math.max(10, maxEndTime);
      const finalData = {
        ...newData,
        duration: updatedDuration
      };

      console.log('📏 Duration recalculated after asset movement:', {
        previousDuration: prev.duration,
        newDuration: updatedDuration,
        maxEndTime,
        assetsCount: newData.tracks.reduce((sum, track) => sum + track.assets.length, 0)
      });

      // Save immediately but don't trigger any reload
      console.log('💾 Saving timeline positions immediately (no reload)');

      // Save in background without affecting current state
      saveTimelinePositions(finalData).then(() => {
        console.log('✅ Timeline saved successfully with updated duration');
      }).catch(error => {
        console.error('❌ Timeline save failed:', error);
      });

      return finalData;
    });
  }, [saveTimelinePositions]);

  const patchTimelineAsset = useCallback((updatedAsset: TimelineAsset) => {
    setTimelineData(prev => {
      let didPatch = false;

      const patchedTracks = prev.tracks.map(track => {
        const nextAssets = track.assets.map(asset => {
          if (asset.id !== updatedAsset.id) return asset;
          didPatch = true;
          return {
            ...asset,
            ...updatedAsset,
            content: {
              ...asset.content,
              ...updatedAsset.content,
            },
            metadata: {
              ...(asset.metadata || {}),
              ...(updatedAsset.metadata || {}),
            },
            created_at: updatedAsset.created_at || asset.created_at,
          };
        });

        if (nextAssets === track.assets) return track;
        return {
          ...track,
          assets: nextAssets,
        };
      });

      if (!didPatch) {
        console.warn('⚠️ patchTimelineAsset: asset not found in local timeline state', updatedAsset.id);
        return prev;
      }

      let maxEndTime = 0;
      patchedTracks.forEach(track => {
        if (track.assets.length > 0) {
          const trackMaxEndTime = Math.max(...track.assets.map(asset => asset.startTime + asset.duration));
          maxEndTime = Math.max(maxEndTime, trackMaxEndTime);
        }
      });

      return {
        ...prev,
        tracks: patchedTracks,
        duration: Math.max(10, maxEndTime),
      };
    });
  }, []);

  // Force refresh timeline data
  const refreshTimelineData = useCallback(() => {
    console.log('🔄 Force refreshing timeline data...');
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Force magnetic rearrangement of all lanes
  const forceRearrangeAllLanes = useCallback(() => {
    console.log('🧲 Force rearranging all lanes with magnetic snapping');

    setTimelineData(prev => {
      const rearrangedTracks = prev.tracks.map(track => {
        if (track.assets.length <= 1) return track;

        console.log(`🧲 Rearranging ${track.type} lane with ${track.assets.length} assets`);

        // Sort assets by creation time or current position
        const sortedAssets = [...track.assets].sort((a, b) => {
          if (a.startTime !== b.startTime) return a.startTime - b.startTime;
          return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
        });

        // Apply magnetic snapping from time 0 (0 gap)
        let currentTime = 0;
        const rearrangedAssets = sortedAssets.map((asset, index) => {
          const rearrangedAsset = {
            ...asset,
            startTime: currentTime
          };
          // 磁吸：下一个资产的开始时间 = 当前资产的结束时间（0时间差）
          currentTime += asset.duration;

          console.log(`🧲 ${track.type} asset ${index + 1}/${sortedAssets.length} repositioned to time ${rearrangedAsset.startTime} (magnetic snap, 0 gap)`);
          return rearrangedAsset;
        });

        return {
          ...track,
          assets: rearrangedAssets
        };
      });

      // Recalculate duration
      let maxEndTime = 0;
      rearrangedTracks.forEach(track => {
        if (track.assets && track.assets.length > 0) {
          const trackMaxEndTime = Math.max(...track.assets.map(asset => asset.startTime + asset.duration));
          maxEndTime = Math.max(maxEndTime, trackMaxEndTime);
        }
      });

      const updatedDuration = Math.max(10, maxEndTime);
      const finalData = {
        ...prev,
        tracks: rearrangedTracks,
        duration: updatedDuration
      };

      console.log('🧲 Force rearrangement completed. Saving to database...');

      // Save the rearranged data
      saveTimelinePositions(finalData).then(() => {
        console.log('✅ Force rearranged timeline saved successfully');
      }).catch(error => {
        console.error('❌ Failed to save force rearranged timeline:', error);
      });

      return finalData;
    });
  }, [saveTimelinePositions]);

  return {
    timelineData,
    updateTimelineData,
    patchTimelineAsset,
    addAssetToTrack,
    moveAssetWithSnap,
    saveTimelinePositions,
    refreshTimelineData,
    forceRearrangeAllLanes,
    isSaving,
    lastSaveTime,
  };
}
