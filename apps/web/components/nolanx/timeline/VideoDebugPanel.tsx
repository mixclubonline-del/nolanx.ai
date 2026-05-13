"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { videoCacheManager } from '@/lib/nolanx/utils/videoCacheManager';
import { videoPerformanceMonitor } from '@/lib/nolanx/utils/videoPerformanceMonitor';
import { Activity, Download, HardDrive, Zap } from 'lucide-react';

interface VideoDebugPanelProps {
  isVisible: boolean;
  onToggle: () => void;
}

export function VideoDebugPanel({ isVisible, onToggle }: VideoDebugPanelProps) {
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [performanceReport, setPerformanceReport] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);

  // 定期更新统计信息
  useEffect(() => {
    if (!isVisible) return;

    const updateStats = () => {
      setCacheStats(videoCacheManager.getCacheStats());
      setPerformanceReport(videoPerformanceMonitor.generateReport());
    };

    updateStats();
    const interval = setInterval(updateStats, 2000);

    return () => clearInterval(interval);
  }, [isVisible, refreshKey]);

  const handleClearCache = () => {
    videoCacheManager.clearCache();
    videoPerformanceMonitor.clear();
    setRefreshKey(prev => prev + 1);
  };

  if (!isVisible) {
    return (
      <Button
        onClick={onToggle}
        variant="outline"
        size="sm"
        className="fixed bottom-4 right-4 z-50 bg-black/80 text-white border-white/20 hover:bg-black/90"
      >
        <Activity className="w-4 h-4 mr-2" />
        Debug
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-h-[80vh] overflow-auto">
      <Card className="bg-black/90 text-white border-white/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Video Performance Debug
            </CardTitle>
            <div className="flex gap-2">
              <Button
                onClick={handleClearCache}
                variant="outline"
                size="sm"
                className="text-xs h-6 px-2"
              >
                Clear
              </Button>
              <Button
                onClick={onToggle}
                variant="outline"
                size="sm"
                className="text-xs h-6 px-2"
              >
                ×
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4 text-xs">
          {/* 缓存统计 */}
          {cacheStats && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardDrive className="w-4 h-4" />
                Cache Stats
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/10 rounded p-2">
                  <div className="text-white/60">Total Videos</div>
                  <div className="font-mono">{cacheStats.totalVideos}</div>
                </div>
                
                <div className="bg-white/10 rounded p-2">
                  <div className="text-white/60">Cache Size</div>
                  <div className="font-mono">{cacheStats.totalSizeMB.toFixed(1)}MB</div>
                </div>
                
                <div className="bg-green-500/20 rounded p-2">
                  <div className="text-green-300">Loaded</div>
                  <div className="font-mono text-green-400">{cacheStats.loadedVideos}</div>
                </div>
                
                <div className="bg-blue-500/20 rounded p-2">
                  <div className="text-blue-300">Loading</div>
                  <div className="font-mono text-blue-400">{cacheStats.loadingVideos}</div>
                </div>
              </div>

              {cacheStats.errorVideos > 0 && (
                <div className="bg-red-500/20 rounded p-2">
                  <div className="text-red-300">Errors</div>
                  <div className="font-mono text-red-400">{cacheStats.errorVideos}</div>
                </div>
              )}
            </div>
          )}

          {/* 性能报告 */}
          {performanceReport && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Zap className="w-4 h-4" />
                Performance Report
              </div>
              
              <div className="bg-white/5 rounded p-2 max-h-40 overflow-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap text-white/80">
                  {performanceReport}
                </pre>
              </div>
            </div>
          )}

          {/* 实时状态 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Download className="w-4 h-4" />
              Live Status
            </div>
            
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className="text-xs">
                Cache Hit Rate: {cacheStats ? Math.round((cacheStats.loadedVideos / Math.max(1, cacheStats.totalVideos)) * 100) : 0}%
              </Badge>
              
              <Badge variant="outline" className="text-xs">
                Memory: {cacheStats ? Math.round((cacheStats.totalSizeMB / cacheStats.maxSizeMB) * 100) : 0}%
              </Badge>
            </div>
          </div>

          {/* 操作提示 */}
          <div className="text-xs text-white/60 border-t border-white/10 pt-2">
            💡 Tips: Watch for stalls and load times. High cache hit rate = better performance.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
