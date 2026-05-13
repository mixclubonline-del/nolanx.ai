import { cn } from '@/lib/utils'

type NolanCanvasLoaderProps = {
  className?: string
  compact?: boolean
  eyebrow?: string
  fullscreen?: boolean
  minimal?: boolean
  title?: string
  subtitle?: string
}

const DEFAULT_TITLE = 'Loading Canvas'
const DEFAULT_SUBTITLE = 'Reassembling timeline, media, and scene state.'

function splitHeadline(title: string) {
  const segments = title.trim().split(/\s+/)
  if (segments.length <= 1) return [title, '']
  return [segments.slice(0, -1).join(' '), segments.at(-1) || '']
}

export function NolanCanvasLoader({
  className,
  compact = false,
  eyebrow = 'NolanX Runtime',
  fullscreen = false,
  minimal = false,
  title = DEFAULT_TITLE,
  subtitle = DEFAULT_SUBTITLE,
}: NolanCanvasLoaderProps) {
  const [titleLead, titleTail] = splitHeadline(title)

  return (
    <div
      className={cn(
        'relative flex h-full min-h-[220px] items-center justify-center overflow-hidden',
        fullscreen ? 'rounded-none' : 'rounded-[1.1rem]',
        minimal
          ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(250,250,249,0.86))] dark:bg-[linear-gradient(180deg,rgba(9,9,11,0.92),rgba(15,23,42,0.88))]'
          : 'bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.08),transparent_28%),linear-gradient(160deg,rgba(255,255,255,0.94),rgba(250,250,249,0.9)_42%,rgba(255,237,213,0.62)_100%)] dark:bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.1),transparent_28%),linear-gradient(160deg,rgba(10,10,10,0.96),rgba(24,24,27,0.94)_42%,rgba(9,9,11,0.97)_100%)]',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className={cn(
          'absolute left-1/2 top-[-12%] -translate-x-1/2 rounded-full bg-orange-500/12 blur-3xl dark:bg-orange-400/12',
          minimal ? 'h-32 w-32' : 'h-40 w-40',
        )} />
        {!minimal ? (
          <>
            <div className="absolute bottom-[-18%] left-[8%] h-32 w-32 rounded-full bg-amber-300/12 blur-3xl dark:bg-amber-500/10" />
            <div className="absolute right-[10%] top-[22%] h-20 w-20 rounded-full border border-orange-500/10 bg-white/14 blur-2xl dark:border-orange-300/10 dark:bg-white/[0.03]" />
          </>
        ) : null}
        <div className={cn('nolan-canvas-loader-grid absolute inset-0 dark:opacity-30', minimal ? 'opacity-28' : 'opacity-38')} />
        <div className={cn('nolan-canvas-loader-scanline absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-500/35 to-transparent', minimal ? 'opacity-50' : 'opacity-70')} />
      </div>

      <div
        className={cn(
          'relative z-10 mx-auto flex w-full max-w-[34rem] flex-col items-center px-6 text-center',
          compact ? 'gap-3 py-7' : 'gap-4 py-10',
        )}
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/14 bg-white/52 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-orange-700 shadow-[0_8px_22px_rgba(251,146,60,0.08)] backdrop-blur-xl dark:border-orange-300/12 dark:bg-white/[0.04] dark:text-orange-200">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500 nolan-canvas-loader-pulse" />
          {eyebrow}
        </div>

        <div className="space-y-2">
          <div className={cn(
            'overflow-hidden font-black uppercase leading-[0.9] text-black dark:text-white',
            minimal
              ? 'text-[clamp(1.5rem,4vw,2.5rem)] tracking-[-0.05em]'
              : 'text-[clamp(1.8rem,5vw,3.4rem)] tracking-[-0.06em]',
          )}>
            <span className="nolan-canvas-loader-collision inline-block">
              {titleLead}
            </span>
            {titleTail ? (
              <>
                {' '}
                <span className="nolan-canvas-loader-shimmer inline-block bg-gradient-to-r from-orange-500 via-amber-300 to-orange-600 bg-[length:220%_100%] bg-clip-text text-transparent">
                  {titleTail}
                </span>
              </>
            ) : null}
          </div>
          <p className="mx-auto max-w-[28rem] text-[11.5px] font-medium tracking-[0.01em] text-black/50 dark:text-white/52">
            {subtitle}
          </p>
        </div>

        <div className="flex w-full max-w-[14rem] flex-col gap-1.5">
          <div className="relative h-[2px] overflow-hidden rounded-full bg-black/7 dark:bg-white/10">
            <div className="nolan-canvas-loader-bar absolute inset-y-0 left-[-18%] w-[34%] rounded-full bg-gradient-to-r from-orange-500 via-amber-300 to-orange-500" />
          </div>
          <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.12em] text-black/34 dark:text-white/36">
            <span>State</span>
            <span>Syncing</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .nolan-canvas-loader-grid {
          background-image:
            linear-gradient(rgba(249, 115, 22, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(249, 115, 22, 0.06) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: radial-gradient(circle at center, black 28%, transparent 84%);
        }

        .nolan-canvas-loader-collision {
          animation: nolanCanvasCollision 2s cubic-bezier(0.22, 1, 0.36, 1) infinite;
        }

        .nolan-canvas-loader-shimmer {
          animation: nolanCanvasShimmer 2.8s linear infinite;
        }

        .nolan-canvas-loader-bar {
          animation: nolanCanvasBar 2.2s ease-in-out infinite;
        }

        .nolan-canvas-loader-pulse {
          animation: nolanCanvasPulse 1.9s ease-in-out infinite;
        }

        .nolan-canvas-loader-scanline {
          animation: nolanCanvasScanline 3.6s linear infinite;
        }

        @keyframes nolanCanvasCollision {
          0%, 100% {
            transform: translateX(0) scale(1);
            letter-spacing: inherit;
            opacity: 1;
          }
          28% {
            transform: translateX(-0.035em) scale(0.992);
          }
          56% {
            transform: translateX(0.03em) scale(1.008);
          }
          76% {
            transform: translateX(-0.01em) scale(0.998);
          }
        }

        @keyframes nolanCanvasShimmer {
          0% {
            background-position: 200% 50%;
          }
          100% {
            background-position: -20% 50%;
          }
        }

        @keyframes nolanCanvasBar {
          0% {
            transform: translateX(0);
            opacity: 0.7;
          }
          50% {
            transform: translateX(190%);
            opacity: 1;
          }
          100% {
            transform: translateX(360%);
            opacity: 0.7;
          }
        }

        @keyframes nolanCanvasPulse {
          0%, 100% {
            transform: scale(0.95);
            opacity: 0.72;
          }
          50% {
            transform: scale(1.15);
            opacity: 1;
          }
        }

        @keyframes nolanCanvasScanline {
          0% {
            transform: translateY(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translateY(520px);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  )
}
