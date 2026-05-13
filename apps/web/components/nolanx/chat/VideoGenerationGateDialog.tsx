"use client";

import { approveVideoGate, cancelChat, getVideoGateState, VideoGateState } from '@/lib/nolanx/api/chat';
import { eventBus, TEvents } from '@/lib/nolanx/utils/event';
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation';
import { Button } from '../ui/button';
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type VideoGatePayload = Pick<VideoGateState, 'batchIndex' | 'totalBatches' | 'clipCount' | 'timeoutSeconds' | 'requestedAt'>;

const computeRemainingSeconds = (payload: Pick<VideoGatePayload, 'timeoutSeconds' | 'requestedAt'>) => {
  const timeoutSeconds = Number(payload.timeoutSeconds || 180);
  const requestedAtMs = payload.requestedAt ? new Date(payload.requestedAt).getTime() : Number.NaN;
  if (!Number.isFinite(requestedAtMs)) {
    return timeoutSeconds;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - requestedAtMs) / 1000));
  return Math.max(0, timeoutSeconds - elapsedSeconds);
};

export default function VideoGenerationGateDialog({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [gate, setGate] = useState<VideoGatePayload | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleInfo = (data: TEvents['Socket::Session::Info']) => {
      if (data.session_id !== sessionId) {
        return;
      }

      if (data.info === 'video_gate_pending' && data.data) {
        const nextGate = data.data as VideoGatePayload;
        setGate(nextGate);
        setRemainingSeconds(computeRemainingSeconds(nextGate));
        setSubmitting(false);
        setOpen(true);
        return;
      }

      if (data.info === 'video_gate_started' || data.info === 'video_gate_auto_started') {
        setSubmitting(false);
        setOpen(false);
      }
    };

    const handleVideoGenerated = (data: TEvents['Socket::Session::VideoGenerated']) => {
      if (data.session_id === sessionId) {
        setSubmitting(false);
        setOpen(false);
      }
    };

    const handleDone = (data: TEvents['Socket::Session::Done']) => {
      if (data.session_id === sessionId) {
        setSubmitting(false);
        setOpen(false);
      }
    };

    const handleError = (data: TEvents['Socket::Session::Error']) => {
      if (data.session_id === sessionId) {
        setSubmitting(false);
      }
    };

    eventBus.on('Socket::Session::Info', handleInfo);
    eventBus.on('Socket::Session::VideoGenerated', handleVideoGenerated);
    eventBus.on('Socket::Session::Done', handleDone);
    eventBus.on('Socket::Session::Error', handleError);
    return () => {
      eventBus.off('Socket::Session::Info', handleInfo);
      eventBus.off('Socket::Session::VideoGenerated', handleVideoGenerated);
      eventBus.off('Socket::Session::Done', handleDone);
      eventBus.off('Socket::Session::Error', handleError);
    };
  }, [sessionId]);

  useEffect(() => {
    let active = true;

    const hydrateGate = async () => {
      try {
        const state = await getVideoGateState(sessionId);
        if (!active || !state || state.status !== 'pending') {
          return;
        }
        const restoredGate: VideoGatePayload = {
          batchIndex: state.batchIndex,
          totalBatches: state.totalBatches,
          clipCount: state.clipCount,
          timeoutSeconds: state.timeoutSeconds,
          requestedAt: state.requestedAt,
        };
        setGate(restoredGate);
        setRemainingSeconds(computeRemainingSeconds(restoredGate));
        setOpen(true);
      } catch (error) {
        console.error('Failed to load video gate state:', error);
      }
    };

    void hydrateGate();

    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!open || remainingSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, remainingSeconds]);

  const handleGenerateNow = async () => {
    try {
      setSubmitting(true);
      await approveVideoGate(sessionId);
      toast.success(t('canvas:timeline.videoGate.generateNow', { defaultValue: 'Generate now' }));
      setOpen(false);
    } catch (error) {
      console.error('Failed to approve video gate:', error);
      toast.error(t('common:errors.generic', { defaultValue: 'Something went wrong. Please try again later.' }));
      setSubmitting(false);
    }
  };

  const handlePauseNow = async () => {
    try {
      setSubmitting(true);
      await cancelChat(sessionId);
      setOpen(false);
      toast.success(t('canvas:timeline.videoGate.pauseNow', { defaultValue: 'Pause now' }));
    } catch (error) {
      console.error('Failed to pause video generation:', error);
      toast.error(t('common:errors.generic', { defaultValue: 'Something went wrong. Please try again later.' }));
      setSubmitting(false);
    }
  };

  return (
    open ? (
      <div className="pointer-events-none absolute bottom-20 right-4 z-30 flex justify-end">
        <div className="pointer-events-auto w-[320px] overflow-hidden rounded-2xl border border-orange-400/20 bg-white/72 shadow-2xl backdrop-blur-2xl dark:border-orange-300/12 dark:bg-[linear-gradient(180deg,rgba(24,23,22,0.22),rgba(12,12,11,0.16))]">
          <div className="bg-gradient-to-r from-orange-500/14 via-orange-400/8 to-transparent px-4 py-3">
            <div className="text-[13px] font-semibold text-foreground">
              {t('canvas:timeline.videoGate.title', { defaultValue: 'Video Generation Checkpoint' })}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {t('canvas:timeline.videoGate.description', { defaultValue: 'The next video batch is ready. Review credits and continue now, or pause the whole agent pipeline before clip generation starts.' })}
            </div>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {t('canvas:timeline.videoGate.batchLabel', {
                  current: gate?.batchIndex || 1,
                  total: gate?.totalBatches || 1,
                  defaultValue: `Batch ${gate?.batchIndex || 1} / ${gate?.totalBatches || 1}`,
                })}
              </span>
              <span>
                {t('canvas:timeline.videoGate.clipLabel', {
                  count: gate?.clipCount || 0,
                  defaultValue: `${gate?.clipCount || 0} clips`,
                })}
              </span>
            </div>

            <div className="rounded-xl border border-orange-400/15 bg-white/55 px-3 py-2 text-sm font-medium text-foreground dark:bg-white/5">
              {remainingSeconds > 0
                ? t('canvas:timeline.videoGate.countdownLabel', {
                    seconds: remainingSeconds,
                    defaultValue: `Auto-generate in ${remainingSeconds}s`,
                  })
                : t('canvas:timeline.videoGate.starting', { defaultValue: 'Starting this batch...' })}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePauseNow}
                disabled={submitting}
                className="h-8 gap-2 rounded-lg border-orange-400/20 bg-white/60 text-foreground hover:bg-white/80 dark:bg-white/5 dark:hover:bg-white/10"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                {t('canvas:timeline.videoGate.pauseNow', { defaultValue: 'Pause now' })}
              </Button>
              <Button
                type="button"
                onClick={handleGenerateNow}
                disabled={submitting || remainingSeconds === 0}
                className="h-8 gap-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                {t('canvas:timeline.videoGate.generateNow', { defaultValue: 'Generate now' })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    ) : null
  );
}
