"use client";

import dynamic from 'next/dynamic';
import { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { NolanCanvasLoader } from './NolanCanvasLoader';

type CanvasExcaliProps = {
  canvasId: string;
  initialData?: ExcalidrawInitialDataState;
};

// 动态导入优化版本的 CanvasExcali 组件，禁用 SSR
const CanvasExcaliOptimized = dynamic(() => import('./CanvasExcaliOptimized'), {
  ssr: false,
  loading: () => (
    <NolanCanvasLoader
      compact
      title="Loading Canvas"
      subtitle="Booting the editor surface and media overlays."
      className="rounded-none"
    />
  ),
});

// 如需回退到原版本，可以取消下面的注释
// const CanvasExcali = dynamic(() => import('./CanvasExcali'), {
//   ssr: false,
//   loading: () => (
//     <div className="flex items-center justify-center h-full cinematic-bg">
//       <div className="flex flex-col items-center gap-4">
//         <div className="relative">
//           <Loader2 className="w-8 h-8 animate-spin cinematic-text-accent" />
//           <div className="absolute inset-0 cinematic-pulse rounded-full" />
//         </div>
//         <p className="cinematic-text-muted text-lg">Loading Canvas...</p>
//       </div>
//     </div>
//   ),
// });

/**
 * 画布组件包装器 - 现在使用优化版本
 *
 * 优化版本的改进：
 * 1. 性能优化：
 *    - 移除了VideoOverlay的setInterval轮询，改用requestAnimationFrame
 *    - 增加了debounce时间，减少频繁保存
 *    - 优化了磁吸计算频率
 *    - 移除了大量调试日志
 *
 * 2. 视频固定问题修复：
 *    - 使用专门的CanvasVideoRenderer组件
 *    - 视频完全跟随画布的缩放和平移
 *    - 使用硬件加速优化渲染性能
 *
 * 3. 架构改进：
 *    - 分离了视频渲染逻辑
 *    - 简化了事件处理
 *    - 更好的状态管理
 */
const CanvasExcaliWrapper: React.FC<CanvasExcaliProps> = (props) => {
  // 使用优化版本
  return <CanvasExcaliOptimized {...props} />;

  // 如需回退到原版本，可以取消下面的注释并注释上面的代码
  // return <CanvasExcali {...props} />;
};

export default CanvasExcaliWrapper;
