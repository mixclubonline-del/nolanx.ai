"use client";

import { getCanvas, renameCanvas, getSharedCanvas } from '@/lib/nolanx/api/canvas';
import { TimelineEditor } from '../timeline/TimelineEditor';
import CanvasHeader from './CanvasHeader';
import ChatInterface from '../chat/Chat';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../ui/resizable';
import { CanvasProvider } from '@/lib/nolanx/contexts/canvas';
import { Session } from '@/lib/nolanx/types/types';
import { ArrowLeft, MessageSquare, Film } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';
import { eventBus, TEvents } from '@/lib/nolanx/utils/event';
import { cn } from '@/lib/utils';
import { NolanCanvasLoader } from './NolanCanvasLoader';
import { useConfigs } from '@/lib/nolanx/contexts/configs';
import '@/styles/nolanx/canvas-chat.css';

interface NolanxCanvasProps {
  canvasId: string;
  onBackToHome?: () => void;
  isShared?: boolean; // 是否为分享模式
}

const INIT_CANVAS_RETRY_INTERVAL_MS = 500;
const INIT_CANVAS_RETRY_WINDOW_MS = 30_000;
const CANVAS_HISTORY_GUARD_STATE = { __nolanxCanvasGuard: true };

type CanvasDetails =
  | Awaited<ReturnType<typeof getCanvas>>
  | Awaited<ReturnType<typeof getSharedCanvas>>;

export function NolanxCanvas({ canvasId, onBackToHome, isShared = false }: NolanxCanvasProps) {
  const router = useRouter();
  const { initCanvas } = useConfigs();
  const [isLoading, setIsLoading] = useState(true);
  const [canvas, setCanvas] = useState<CanvasDetails | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [canvasName, setCanvasName] = useState('');
  const [sessionList, setSessionList] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<'canvas' | 'chat'>('canvas');
  const [hasMountedChat, setHasMountedChat] = useState(false);
  const [hasMountedCanvas, setHasMountedCanvas] = useState(true);
  const [hasLoadedCanvas, setHasLoadedCanvas] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const initRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRetryStartedAtRef = useRef(0);
  const skipNextPopstateGuardRef = useRef(false);

  // Detect mobile screen
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (mobileActiveTab === 'chat') {
      setHasMountedChat(true);
    } else {
      setHasMountedCanvas(true);
    }
  }, [mobileActiveTab]);

  useEffect(() => {
    setHasLoadedCanvas(false);
    initRetryStartedAtRef.current = Date.now();
    if (initRetryTimeoutRef.current) {
      clearTimeout(initRetryTimeoutRef.current);
      initRetryTimeoutRef.current = null;
    }
  }, [canvasId]);

  useEffect(() => {
    if (isShared || typeof window === 'undefined') {
      return;
    }

    try {
      window.history.pushState(CANVAS_HISTORY_GUARD_STATE, '', window.location.href);
    } catch (error) {
      console.warn('Failed to install canvas history guard:', error);
    }

    const handlePopState = () => {
      if (skipNextPopstateGuardRef.current) {
        skipNextPopstateGuardRef.current = false;
        return;
      }
      try {
        window.history.pushState(CANVAS_HISTORY_GUARD_STATE, '', window.location.href);
      } catch (error) {
        console.warn('Failed to restore canvas history guard:', error);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [canvasId, isShared]);

  useEffect(() => {
    let mounted = true;

    const fetchCanvas = async () => {
      let keepLoading = false;

      try {
        if (!hasLoadedCanvas) {
          setIsLoading(true);
        }
        setError(null);
        // 根据是否为分享模式选择不同的API
        const data = isShared ? await getSharedCanvas(canvasId) : await getCanvas(canvasId);
        if (mounted) {
          setCanvas(data);
          setCanvasName(data.name);
          setSessionList(data.sessions || []);
          setHasLoadedCanvas(true);
        }
      } catch (err) {
        if (mounted) {
          const errorCode = typeof (err as { code?: unknown })?.code === 'number'
            ? (err as { code: number }).code
            : null;
          const shouldRetryInitLoad =
            !isShared &&
            initCanvas &&
            !hasLoadedCanvas &&
            errorCode === 404 &&
            Date.now() - initRetryStartedAtRef.current < INIT_CANVAS_RETRY_WINDOW_MS;

          if (shouldRetryInitLoad) {
            keepLoading = true;
            setError(null);
            initRetryTimeoutRef.current = setTimeout(() => {
              if (mounted) {
                void fetchCanvas();
              }
            }, INIT_CANVAS_RETRY_INTERVAL_MS);
            return;
          }

          setError(
            err instanceof Error
              ? err
              : new Error('Failed to fetch canvas data')
          );
          console.error('Failed to fetch canvas data:', err);
        }
      } finally {
        if (mounted && !keepLoading) {
          setIsLoading(false);
        }
      }
    };

    fetchCanvas();

    return () => {
      mounted = false;
      if (initRetryTimeoutRef.current) {
        clearTimeout(initRetryTimeoutRef.current);
        initRetryTimeoutRef.current = null;
      }
    };
  }, [canvasId, isShared, hasLoadedCanvas, initCanvas]);

  // Listen for canvas data updates from chat (only for new content, not conversation completion)
  useEffect(() => {
    const handleCanvasDataUpdate = async (data: TEvents['Canvas::DataUpdated']) => {
      if (data.canvasId === canvasId) {
        console.log('🔄 NolanxCanvas received data update event:', data.trigger);

        // Only refresh for new content generation, not for conversation completion
        if (
          data.trigger === 'image_generated' ||
          data.trigger === 'video_generated' ||
          data.trigger === 'audio_generated' ||
          data.trigger === 'script_generated'
        ) {
          console.log('🔄 Scheduling debounced canvas refresh for generated content');

          if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
          }

          refreshTimeoutRef.current = setTimeout(async () => {
            if (refreshInFlightRef.current) {
              console.log('⏭️ Canvas refresh already in flight, skipping duplicate request');
              return;
            }

            refreshInFlightRef.current = true;

            try {
              const updatedCanvas = await getCanvas(canvasId);
              setCanvas(updatedCanvas);
              setSessionList(updatedCanvas.sessions || []);
              console.log('✅ Canvas data refreshed successfully');
            } catch (err) {
              console.error('❌ Failed to refresh canvas data:', err);
            } finally {
              refreshInFlightRef.current = false;
            }
          }, 250);
        } else {
          console.log('⏭️ Skipping canvas refresh for non-content update:', data.trigger);
        }
      }
    };

    eventBus.on('Canvas::DataUpdated', handleCanvasDataUpdate);

    return () => {
      eventBus.off('Canvas::DataUpdated', handleCanvasDataUpdate);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [canvasId]);

  const handleNameSave = async () => {
    try {
      await renameCanvas(canvasId, canvasName);
    } catch (err) {
      console.error('Failed to rename canvas:', err);
    }
  };

  const handleBackToHome = () => {
    skipNextPopstateGuardRef.current = true;
    if (onBackToHome) {
      onBackToHome();
    } else {
      router.push('/nolanx');
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <p className="text-red-500 mb-4">Error: {error.message}</p>
        <Button onClick={handleBackToHome} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>
      </div>
    );
  }

  // Mobile layout with tab switching
  if (isMobile) {
    return (
      <CanvasProvider>
        <div className="fixed inset-0 flex flex-col w-screen h-screen cinematic-bg" data-canvas-page>
          <CanvasHeader
            canvasName={canvasName}
            canvasId={canvasId}
            sessionId={currentSession?.id}
            sessionTitle={currentSession?.title}
            canvasData={canvas?.data}
            onNameChange={setCanvasName}
            onNameSave={handleNameSave}
            onBackToHome={handleBackToHome}
            isShared={isShared}
          />

          {/* Mobile Content Area - takes remaining space above bottom bar */}
          <div className="flex-1 relative overflow-hidden" style={{ paddingBottom: '64px' }}>
            {isLoading ? (
              <NolanCanvasLoader
                compact
                title="Loading Canvas"
                subtitle="Reassembling tracks, sessions, and attached media."
                className="h-full rounded-none"
              />
            ) : (
              <>
                {/* Canvas View */}
                {hasMountedCanvas && (
                  <div
                    className={cn(
                      "absolute inset-0 transition-transform duration-300 ease-in-out",
                      mobileActiveTab === 'canvas' ? "translate-x-0" : "-translate-x-full"
                    )}
                    style={{ bottom: '64px' }}
                  >
                    <div className="w-full h-full cinematic-surface">
                      <TimelineEditor
                        canvasId={canvasId}
                        initialData={canvas?.data}
                        sessionList={sessionList}
                        canvasData={canvas?.data}
                        isShared={isShared}
                        key={`timeline-${canvasId}`}
                      />
                    </div>
                  </div>
                )}

                {/* Chat View */}
                {hasMountedChat && (
                  <div
                    className={cn(
                      "absolute inset-0 transition-transform duration-300 ease-in-out overflow-hidden rounded-t-[1.75rem] bg-transparent",
                      mobileActiveTab === 'chat' ? "translate-x-0" : "translate-x-full"
                    )}
                    style={{ bottom: '64px' }}
                  >
                    <ChatInterface
                      canvasId={canvasId}
                      sessionList={sessionList}
                      setSessionList={setSessionList}
                      isShared={isShared}
                      onSessionChange={setCurrentSession}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mobile Bottom Tab Bar - Fixed at bottom with high z-index */}
          <div className="fixed bottom-0 left-0 right-0 z-50 flex h-16 pt-2 rounded-t-2xl border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-black/95 backdrop-blur-xl safe-area-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
            <button
              onClick={() => setMobileActiveTab('canvas')}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-colors pb-1",
                mobileActiveTab === 'canvas'
                  ? "text-orange-500"
                  : "text-gray-500 dark:text-gray-400"
              )}
            >
              <Film className="w-5 h-5" />
              <span className="text-xs font-medium">Canvas</span>
            </button>
            <button
              onClick={() => setMobileActiveTab('chat')}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-colors pb-1",
                mobileActiveTab === 'chat'
                  ? "text-orange-500"
                  : "text-gray-500 dark:text-gray-400"
              )}
            >
              <MessageSquare className="w-5 h-5" />
              <span className="text-xs font-medium">Chat</span>
            </button>
          </div>
        </div>
      </CanvasProvider>
    );
  }

  // Desktop layout with resizable panels
  return (
    <CanvasProvider>
      <div className="flex flex-col w-screen h-screen cinematic-bg overflow-hidden" data-canvas-page>
        <CanvasHeader
          canvasName={canvasName}
          canvasId={canvasId}
          sessionId={currentSession?.id}
          sessionTitle={currentSession?.title}
          canvasData={canvas?.data}
          onNameChange={setCanvasName}
          onNameSave={handleNameSave}
          onBackToHome={handleBackToHome}
          isShared={isShared}
        />
        <ResizablePanelGroup
          direction="horizontal"
          className="w-screen flex-1 min-w-0 overflow-hidden"
          autoSaveId="jazz-chat-panel"
        >
          <ResizablePanel className="relative min-w-0" defaultSize={75}>
            <div className="w-full h-full cinematic-surface">
              {isLoading ? (
                <NolanCanvasLoader
                  compact
                  title="Loading Canvas"
                  subtitle="Reassembling tracks, sessions, and attached media."
                  className="h-full rounded-none"
                />
              ) : (
                <>
                  <TimelineEditor
                    canvasId={canvasId}
                    initialData={canvas?.data}
                    sessionList={sessionList}
                    canvasData={canvas?.data}
                    isShared={isShared}
                    key={`timeline-${canvasId}`}
                  />
                </>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel className="min-w-0" defaultSize={25} maxSize={40} minSize={20}>
            <div className="flex flex-col min-h-0 flex-1 flex-grow w-full h-full min-w-0 overflow-hidden rounded-none bg-transparent">
              <ChatInterface
                canvasId={canvasId}
                sessionList={sessionList}
                setSessionList={setSessionList}
                isShared={isShared}
                onSessionChange={setCurrentSession}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </CanvasProvider>
  );
}
