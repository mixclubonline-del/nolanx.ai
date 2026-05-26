"use client";

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { useSSRSafeTranslation } from '@/lib/nolanx/hooks/use-ssr-safe-translation';

// Nolanx imports
import { createCanvas } from '@/lib/nolanx/api/canvas';
import { ChatTextarea } from './chat/ChatTextarea';
import { CanvasList } from './home/CanvasList';
import { NolanHeroBanner } from '@/components/nolan/nolan-hero-banner';
import { NolanxVideoHeroBackground } from './home/NolanxVideoHeroBackground';

import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { useConfigs } from '@/lib/nolanx/contexts/configs';
import { useRouter, useSearchParams } from "next/navigation";
import '@/styles/nolanx/nolan-zen.css';
import '@/styles/nolanx/nolan-dreamlike-chat.css';
import { cn } from '@/lib/utils';
import { useLocale } from 'next-intl';
import { localizePathname } from '@/i18n/pathname';
import { isNolanxHostname } from '@/lib/site';

type TabType = 'canvases' | 'community';

const MOCK_COMMUNITY_URL = 'https://nolanx.ai/canvas/share/74d497c6-6c47-4feb-aedd-da2bacc338c5?sessionId=dfb2210f-db00-49fd-82f8-5061c7a67ce2';
const MOCK_COMMUNITY_COVER_VIDEO = 'https://gen-video.tos-ap-southeast-1.bytepluses.com/dreamina-seedance-2-0/02177805162773200000000000000000000ffffc0a899b549ef62.mp4';

const HERO_VIDEOS = [
  'https://pub-fb1cce7145174a7b9989934451fb797a.r2.dev/nolanx/02177733952850600000000000000000000ffffc0a86fd66bc225%20(1).mp4',
  'https://pub-fb1cce7145174a7b9989934451fb797a.r2.dev/nolanx/02177733961738400000000000000000000ffffc0a8b52c540e8c.mp4',
  'https://pub-fb1cce7145174a7b9989934451fb797a.r2.dev/nolanx/02177733965872100000000000000000000ffffc0a86fd6fb1040.mp4',
  'https://pub-fb1cce7145174a7b9989934451fb797a.r2.dev/nolanx/02177786268017900000000000000000000ffffc0a8b7d6a9f305.mp4',
  'https://pub-fb1cce7145174a7b9989934451fb797a.r2.dev/nolanx/02177805599370200000000000000000000ffffc0a86a03bcfe6c.mp4',
  'https://pub-fb1cce7145174a7b9989934451fb797a.r2.dev/nolanx/02177805613996400000000000000000000ffffc0a89a5c2d86d4.mp4',
];

export function NolanxHome() {
  const { t } = useSSRSafeTranslation();
  const { setInitCanvas } = useConfigs();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const appLocale = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const [activeTab, setActiveTab] = useState<TabType>('community');
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const showReelMindButton =
    typeof window !== 'undefined' && isNolanxHostname(window.location.hostname);

  // 获取URL中的prompt参数
  const initialPrompt = searchParams?.get('prompt');

  return (
    <div className="nolanx-video-home flex h-full flex-col bg-[#050403] text-white">
      <div className="pointer-events-none fixed left-3 top-3 z-50 flex items-center gap-1.5 md:left-4 md:top-4">
        <Image
          src="/logo_dark_nolanx.png"
          alt="NolanX"
          width={112}
          height={34}
          priority
          className="h-auto w-24 object-contain drop-shadow-[0_14px_30px_rgba(0,0,0,0.38)]"
        />
        <span className="rounded-full border border-[#f37021] bg-[#f37021] px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-[0.1em] text-black shadow-[0_10px_26px_rgba(243,112,33,0.24)]">
          V1.1
        </span>
      </div>
      <ScrollArea className="h-full">
        <div className="relative isolate overflow-hidden">
          <div className="relative flex min-h-[88svh] flex-col items-center justify-center px-4 pb-32 pt-[92px] md:min-h-[104svh] md:px-6 md:pb-44 md:pt-[108px]">
            <NolanxVideoHeroBackground videos={HERO_VIDEOS} />

            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#050403]/76 via-[#050403]/30 to-transparent" />

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="relative z-10 flex w-full max-w-[76rem] flex-col items-center"
            >
              <NolanHeroBanner transparent />

              {showReelMindButton ? (
                <div className="relative z-10 mt-4 flex w-full justify-center">
                  <Button
                    asChild
                    variant="outline"
                    className="h-10 rounded-full border-white/18 bg-white/[0.04] px-5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(0,0,0,0.24)] backdrop-blur-xl hover:bg-white/[0.08] hover:text-white dark:border-white/18 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                  >
                    <Link href="https://reelmind.ai/" target="_blank" rel="noreferrer">
                      Explore ReelMind
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </Button>
                </div>
              ) : null}

              <div className="relative z-10 mx-auto mt-4 w-full max-w-2xl px-1 sm:px-0">
                <ChatTextarea
                  className="w-full"
                  messages={[]}
                  initialPrompt={initialPrompt || undefined}
                  autoSend={false}
                  showSleepButton={false}
                  onSendMessages={(messages) => {
                    const canvasId = crypto.randomUUID();
                    const canvasPath = localizePathname(`/canvas/${canvasId}`, appLocale);
                    setInitCanvas(true);
                    setIsCreatingCanvas(true);
                    router.push(canvasPath);

                    window.setTimeout(() => {
                      void createCanvas({
                        canvas_id: canvasId,
                        messages,
                        preferred_language: locale || 'en',
                      }).catch((error) => {
                        setInitCanvas(false);
                        setIsCreatingCanvas(false);
                        toast.error(t('common:messages.error', 'An error occurred'), {
                          description: error.message,
                        });
                      });
                    }, 0);
                  }}
                  pending={isCreatingCanvas}
                />
              </div>

            </motion.div>
          </div>

          <section className="relative z-10 -mt-28 rounded-t-[2rem] bg-[linear-gradient(180deg,rgba(5,4,3,0.28),rgba(5,4,3,0.88)_120px,rgba(5,4,3,1)_260px)] px-4 pb-12 pt-6 md:-mt-40 md:rounded-t-[2.5rem] md:px-6 md:pt-8">
            <div className="mx-auto flex max-w-7xl justify-center">
              <div className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] p-1 shadow-[0_24px_60px_rgba(0,0,0,0.26)] backdrop-blur-2xl">
                <button
                  onClick={() => setActiveTab('canvases')}
                  className={cn(
                    "rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 md:px-6",
                    activeTab === 'canvases'
                      ? "bg-white/[0.09] text-white shadow-[0_12px_32px_rgba(0,0,0,0.24)]"
                      : "text-white/56 hover:bg-white/[0.04] hover:text-white/88"
                  )}
                >
                  {t('home:tabs.myCanvases', locale === 'zh-CN' ? '我的画布' : 'My Canvases')}
                </button>
                <button
                  onClick={() => setActiveTab('community')}
                  className={cn(
                    "rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 md:px-6",
                    activeTab === 'community'
                      ? "bg-white/[0.09] text-white shadow-[0_12px_32px_rgba(0,0,0,0.24)]"
                      : "text-white/56 hover:bg-white/[0.04] hover:text-white/88"
                  )}
                >
                  {t('home:tabs.community', locale === 'zh-CN' ? '社区' : 'Community')}
                </button>
              </div>
            </div>

            <div className="relative z-10 mt-6">
              {activeTab === 'canvases' ? (
                <CanvasList />
              ) : (
                <div className="mx-auto max-w-[1120px] px-4 pb-8 md:px-10">
                  <a
                    href={MOCK_COMMUNITY_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition-transform duration-300 hover:-translate-y-1 hover:border-white/18"
                  >
                    <div className="grid md:grid-cols-[1.15fr_0.85fr]">
                      <div className="relative min-h-[280px] overflow-hidden bg-black">
                        <video
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                          src={MOCK_COMMUNITY_COVER_VIDEO}
                          autoPlay
                          muted
                          loop
                          playsInline
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.4)_46%,rgba(0,0,0,0.84))]" />
                        <div className="absolute left-5 top-5 rounded-full border border-white/12 bg-black/28 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/74 backdrop-blur-xl md:left-6 md:top-6">
                          {locale === 'zh-CN' ? 'Mock Community Pick' : 'Mock Community Pick'}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
                          <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                            {locale === 'zh-CN' ? '历史记录 / Public Share Demo' : 'History Record / Public Share Demo'}
                          </div>
                          <h3 className="mt-2 text-2xl font-semibold text-white md:text-[2rem]">
                            Featured Public Canvas
                          </h3>
                          <p className="mt-3 max-w-xl text-sm leading-7 text-white/68 md:text-base">
                            {locale === 'zh-CN'
                              ? '保留一个历史记录风格的社区示例，用来演示开源版里的公开分享链路。点击后直接打开 mock shared canvas。'
                              : 'Keep one history-style community record so the public share flow remains demonstrable in the open-source build. Click to open the mock shared canvas.'}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between gap-5 p-6 md:p-8">
                        <div className="flex items-center justify-between gap-4">
                          <div className="text-sm font-medium text-white/78">
                            {locale === 'zh-CN' ? '示例公开记录' : 'Mock Community Record'}
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/72">
                            {locale === 'zh-CN' ? '点击查看' : 'Open'}
                          </div>
                        </div>

                        <div className="grid gap-3 text-sm text-white/64">
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                              {locale === 'zh-CN' ? '类型' : 'Type'}
                            </div>
                            <div className="mt-1 text-white/88">Featured Public Canvas</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                              {locale === 'zh-CN' ? '用途' : 'Purpose'}
                            </div>
                            <div className="mt-1 text-white/88">
                              {locale === 'zh-CN' ? '演示公开 share / replay 链路' : 'Demo of the public share / replay flow'}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                              {locale === 'zh-CN' ? '目标链接' : 'Target URL'}
                            </div>
                            <div className="mt-1 break-all text-white/62">{MOCK_COMMUNITY_URL}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </a>
                </div>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
