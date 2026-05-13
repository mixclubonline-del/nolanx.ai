/**
 * 视频播放性能监控工具
 * 用于监控和分析视频播放卡顿问题
 */

interface VideoPerformanceMetrics {
  videoUrl: string;
  loadStartTime: number;
  loadEndTime?: number;
  playStartTime?: number;
  stallCount: number;
  stallDuration: number;
  bufferHealth: number[];
  seekCount: number;
  lastSeekTime?: number;
}

class VideoPerformanceMonitor {
  private metrics = new Map<string, VideoPerformanceMetrics>();
  private observers = new Map<HTMLVideoElement, ResizeObserver>();

  /**
   * 开始监控视频元素
   */
  startMonitoring(video: HTMLVideoElement, videoUrl: string): () => void {
    const metrics: VideoPerformanceMetrics = {
      videoUrl,
      loadStartTime: performance.now(),
      stallCount: 0,
      stallDuration: 0,
      bufferHealth: [],
      seekCount: 0,
    };

    this.metrics.set(videoUrl, metrics);

    // 监听视频事件
    const handleLoadStart = () => {
      metrics.loadStartTime = performance.now();
      console.log('📹 Video load started:', videoUrl);
    };

    const handleCanPlay = () => {
      metrics.loadEndTime = performance.now();
      const loadTime = metrics.loadEndTime - metrics.loadStartTime;
      console.log('📹 Video can play:', videoUrl, `(${loadTime.toFixed(0)}ms)`);
    };

    const handlePlay = () => {
      metrics.playStartTime = performance.now();
      console.log('▶️ Video play started:', videoUrl);
    };

    const handleWaiting = () => {
      metrics.stallCount++;
      const stallStart = performance.now();
      console.warn('⏳ Video stalled:', videoUrl, `(stall #${metrics.stallCount})`);

      const handlePlaying = () => {
        const stallEnd = performance.now();
        const stallDuration = stallEnd - stallStart;
        metrics.stallDuration += stallDuration;
        console.log('▶️ Video resumed after stall:', videoUrl, `(${stallDuration.toFixed(0)}ms)`);
        video.removeEventListener('playing', handlePlaying);
      };

      video.addEventListener('playing', handlePlaying, { once: true });
    };

    const handleSeeked = () => {
      metrics.seekCount++;
      metrics.lastSeekTime = performance.now();
      console.log('🎯 Video seeked:', videoUrl, `(seek #${metrics.seekCount})`);
    };

    const handleTimeUpdate = () => {
      // 监控缓冲健康度
      if (video.buffered.length > 0) {
        const currentTime = video.currentTime;
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferAhead = bufferedEnd - currentTime;
        metrics.bufferHealth.push(bufferAhead);

        // 只保留最近100个数据点
        if (metrics.bufferHealth.length > 100) {
          metrics.bufferHealth.shift();
        }
      }
    };

    // 添加事件监听器
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('play', handlePlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);

    // 返回清理函数
    return () => {
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      
      this.metrics.delete(videoUrl);
    };
  }

  /**
   * 获取性能指标
   */
  getMetrics(videoUrl: string): VideoPerformanceMetrics | null {
    return this.metrics.get(videoUrl) || null;
  }

  /**
   * 获取所有性能指标
   */
  getAllMetrics(): VideoPerformanceMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const allMetrics = this.getAllMetrics();
    
    if (allMetrics.length === 0) {
      return 'No video performance data available.';
    }

    const report = ['📊 Video Performance Report', '=' .repeat(40)];
    
    allMetrics.forEach((metrics, index) => {
      const loadTime = metrics.loadEndTime ? 
        (metrics.loadEndTime - metrics.loadStartTime).toFixed(0) : 'N/A';
      
      const avgBufferHealth = metrics.bufferHealth.length > 0 ?
        (metrics.bufferHealth.reduce((a, b) => a + b, 0) / metrics.bufferHealth.length).toFixed(1) : 'N/A';

      report.push(
        `\n${index + 1}. ${metrics.videoUrl.split('/').pop()}`,
        `   Load Time: ${loadTime}ms`,
        `   Stalls: ${metrics.stallCount} (${metrics.stallDuration.toFixed(0)}ms total)`,
        `   Seeks: ${metrics.seekCount}`,
        `   Avg Buffer: ${avgBufferHealth}s`
      );
    });

    // 总体统计
    const totalStalls = allMetrics.reduce((sum, m) => sum + m.stallCount, 0);
    const totalStallTime = allMetrics.reduce((sum, m) => sum + m.stallDuration, 0);
    const avgLoadTime = allMetrics
      .filter(m => m.loadEndTime)
      .reduce((sum, m) => sum + (m.loadEndTime! - m.loadStartTime), 0) / allMetrics.length;

    report.push(
      '\n📈 Summary:',
      `   Total Videos: ${allMetrics.length}`,
      `   Total Stalls: ${totalStalls}`,
      `   Total Stall Time: ${totalStallTime.toFixed(0)}ms`,
      `   Avg Load Time: ${avgLoadTime.toFixed(0)}ms`
    );

    return report.join('\n');
  }

  /**
   * 清理所有监控数据
   */
  clear(): void {
    this.metrics.clear();
    this.observers.clear();
  }
}

// 创建全局实例
export const videoPerformanceMonitor = new VideoPerformanceMonitor();

// 在开发环境下暴露到全局对象，方便调试
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).videoPerformanceMonitor = videoPerformanceMonitor;
}
