"use client";

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineData } from '@/lib/nolanx/types/timeline';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';

interface VideoComposerProps {
  timelineData: TimelineData;
  onExportComplete?: (videoBlob: Blob) => void;
  onExportError?: (error: string) => void;
}

function canUseBrowserFfmpeg(pathname: string | null) {
  if (!pathname) return false;
  return pathname === '/canvas' || pathname.startsWith('/canvas/') || /^\/[a-z]{2}(?:-[A-Z]{2})?\/canvas(?:\/|$)/.test(pathname);
}

export function VideoComposer({ timelineData, onExportComplete, onExportError }: VideoComposerProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [isExporting, setIsExporting] = useState(false);

  // 🎬 全新的基于时间轴的视频导出方案
  const handleExport = useCallback(async () => {
    if (isExporting) return;

    if (!canUseBrowserFfmpeg(pathname)) {
      onExportError?.('Export is only available in Canvas.');
      return;
    }

    console.log('🎬 Starting timeline-based video export...');
    setIsExporting(true);

    try {
      // 1. 收集和分析时间轴数据
      const videoTrack = timelineData.tracks.find(t => t.type === 'video');
      const audioTrack = timelineData.tracks.find(t => t.type === 'audio');

      const videoAssets = videoTrack?.assets
        .filter(asset => asset.content.videoUrl)
        .sort((a, b) => a.startTime - b.startTime) || [];

      const audioAssets = audioTrack?.assets
        .filter(asset => asset.content.audioUrl)
        .sort((a, b) => a.startTime - b.startTime) || [];

      if (videoAssets.length === 0) {
        throw new Error('No video assets found to export');
      }

      // 2. 计算总时长和时间轴布局
      const totalDuration = Math.max(
        timelineData.duration,
        ...videoAssets.map(asset => asset.startTime + asset.duration),
        ...audioAssets.map(asset => asset.startTime + asset.duration)
      );

      console.log('📊 Timeline analysis:', {
        totalDuration,
        videoAssets: videoAssets.map(a => ({
          id: a.id,
          startTime: a.startTime,
          duration: a.duration,
          endTime: a.startTime + a.duration
        })),
        audioAssets: audioAssets.map(a => ({
          id: a.id,
          startTime: a.startTime,
          duration: a.duration,
          endTime: a.startTime + a.duration
        }))
      });

      // 3. 动态导入FFmpeg
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');

      const ffmpeg = new FFmpeg();
      await ffmpeg.load();

      // 4. 下载所有媒体文件
      const videoInputs: Array<{
        filename: string;
        asset: typeof videoAssets[0];
        index: number;
      }> = [];

      for (let i = 0; i < videoAssets.length; i++) {
        const asset = videoAssets[i];
        const filename = `input_video_${i}.mp4`;
        const data = await fetchFile(asset.content.videoUrl!);
        await ffmpeg.writeFile(filename, data);
        videoInputs.push({ filename, asset, index: i });
      }

      const audioInputs: Array<{
        filename: string;
        asset: typeof audioAssets[0];
        index: number;
      }> = [];

      for (let i = 0; i < audioAssets.length; i++) {
        const asset = audioAssets[i];
        const filename = `input_audio_${i}.mp3`;
        const data = await fetchFile(asset.content.audioUrl!);
        await ffmpeg.writeFile(filename, data);
        audioInputs.push({ filename, asset, index: i });
      }

      // 5. 🎯 使用FFmpeg filter_complex进行精确的时间轴合成
      await createTimelineComposition(ffmpeg, {
        videoInputs,
        audioInputs,
        totalDuration,
        outputFilename: 'timeline_output.mp4'
      });

      // 6. 读取输出文件
      const data = await ffmpeg.readFile('timeline_output.mp4');
      const videoBlob = new Blob([data], { type: 'video/mp4' });

      // 下载视频
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timeline-export-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('✅ Timeline export completed successfully');
      onExportComplete?.(videoBlob);
      setIsExporting(false);

    } catch (error) {
      console.error('❌ Timeline export failed:', error);
      onExportError?.(error instanceof Error ? error.message : 'Export failed');
      setIsExporting(false);
    }
  }, [timelineData, onExportComplete, onExportError, isExporting, pathname]);

  // 🎬 创建基于时间轴的视频合成 - 简化版本
  const createTimelineComposition = async (
    ffmpeg: any,
    options: {
      videoInputs: Array<{ filename: string; asset: any; index: number }>;
      audioInputs: Array<{ filename: string; asset: any; index: number }>;
      totalDuration: number;
      outputFilename: string;
    }
  ) => {
    const { videoInputs, audioInputs, totalDuration, outputFilename } = options;

    // 🎯 方案1: 使用更简单但可靠的方法
    // 为每个视频创建带时间偏移的片段，然后拼接
    const processedVideoFiles: string[] = [];

    for (let i = 0; i < videoInputs.length; i++) {
      const { filename, asset } = videoInputs[i];
      const startTime = asset.startTime;
      const duration = asset.duration;
      const processedFilename = `processed_video_${i}.mp4`;

      if (startTime > 0) {
        // 如果视频不是从0开始，先创建黑屏填充
        const blackFilename = `black_${i}.mp4`;

        // 创建黑屏视频
        await ffmpeg.exec([
          '-f', 'lavfi',
          '-i', `color=black:size=1920x1080:duration=${startTime}`,
          '-c:v', 'libx264',
          '-y',
          blackFilename
        ]);

        // 将黑屏和实际视频拼接
        await ffmpeg.exec([
          '-i', blackFilename,
          '-i', filename,
          '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map', '[v]',
          '-c:v', 'libx264',
          '-y',
          processedFilename
        ]);
      } else {
        // 直接复制视频
        await ffmpeg.exec([
          '-i', filename,
          '-c:v', 'libx264',
          '-y',
          processedFilename
        ]);
      }

      processedVideoFiles.push(processedFilename);
    }

    // 🎬 拼接所有处理过的视频
    if (processedVideoFiles.length === 1) {
      // 单个视频，直接重命名
      await ffmpeg.exec([
        '-i', processedVideoFiles[0],
        '-c:v', 'copy',
        '-t', totalDuration.toString(),
        '-y',
        outputFilename
      ]);
    } else {
      // 多个视频，创建拼接列表
      const concatList = processedVideoFiles.map(file => `file '${file}'`).join('\n');
      await ffmpeg.writeFile('video_concat_list.txt', concatList);

      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'video_concat_list.txt',
        '-c:v', 'copy',
        '-t', totalDuration.toString(),
        '-y',
        outputFilename
      ]);
    }

    // 🎵 处理音频（如果有）
    if (audioInputs.length > 0) {
      await addAudioToVideo(ffmpeg, audioInputs, outputFilename, totalDuration);
    }

    console.log('✅ Timeline composition completed');
  };

  // 🎵 将音频添加到视频中
  const addAudioToVideo = async (
    ffmpeg: any,
    audioInputs: Array<{ filename: string; asset: any; index: number }>,
    videoFilename: string,
    totalDuration: number
  ) => {
    // 处理音频时间轴
    const processedAudioFiles: string[] = [];

    for (let i = 0; i < audioInputs.length; i++) {
      const { filename, asset } = audioInputs[i];
      const startTime = asset.startTime;
      const processedAudioFilename = `processed_audio_${i}.mp3`;

      if (startTime > 0) {
        // 在音频前添加静音
        const silenceFilename = `silence_${i}.mp3`;

        // 创建静音
        await ffmpeg.exec([
          '-f', 'lavfi',
          '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
          '-t', startTime.toString(),
          '-y',
          silenceFilename
        ]);

        // 拼接静音和音频
        await ffmpeg.exec([
          '-i', silenceFilename,
          '-i', filename,
          '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]',
          '-map', '[a]',
          '-y',
          processedAudioFilename
        ]);
      } else {
        // 直接复制音频
        await ffmpeg.exec([
          '-i', filename,
          '-y',
          processedAudioFilename
        ]);
      }

      processedAudioFiles.push(processedAudioFilename);
    }

    // 混合所有音频
    let finalAudioFilename = 'final_audio.mp3';
    if (processedAudioFiles.length === 1) {
      finalAudioFilename = processedAudioFiles[0];
    } else {
      // 混合多个音频
      const inputArgs = processedAudioFiles.flatMap(file => ['-i', file]);
      const filterInputs = processedAudioFiles.map((_, i) => `[${i}:a]`).join('');

      await ffmpeg.exec([
        ...inputArgs,
        '-filter_complex', `${filterInputs}amix=inputs=${processedAudioFiles.length}:duration=longest[a]`,
        '-map', '[a]',
        '-y',
        finalAudioFilename
      ]);
    }

    // 将音频合并到视频
    const finalOutputFilename = 'final_with_audio.mp4';
    await ffmpeg.exec([
      '-i', videoFilename,
      '-i', finalAudioFilename,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-t', totalDuration.toString(),
      '-y',
      finalOutputFilename
    ]);

    // 替换原视频文件
    await ffmpeg.exec([
      '-i', finalOutputFilename,
      '-c', 'copy',
      '-y',
      videoFilename
    ]);
  };





  return (
    <div className="flex items-center gap-4">
      <Button
        onClick={handleExport}
        disabled={isExporting}
        className="bg-orange-600 hover:bg-orange-700 text-white relative"
      >
        {isExporting ? (
          <div className="w-4 h-4 mr-2 animate-spin">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="60">
                <animate attributeName="stroke-dashoffset" values="60;0;60" dur="2s" repeatCount="indefinite"/>
              </circle>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
        ) : (
          <Download className="w-4 h-4 mr-2" />
        )}
        {isExporting ? t('canvas:preview.exporting') : t('canvas:preview.exportVideo')}
      </Button>
    </div>
  );
}
