"use client"

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useThemeContext } from '@/contexts/theme-context'
import { useTranslations } from 'next-intl'

interface Mosaic {
  id: number
  x: number
  y: number
  size: number
  delay: number
  duration: number
}

interface Particle {
  id: number
  left: string
  top: string
  animationDelay: string
  animationDuration: string
}

function deterministicUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function formatPercent(value: number) {
  return `${value.toFixed(5)}%`
}

function formatSeconds(value: number) {
  return `${value.toFixed(5)}s`
}

function createStaticParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    left: formatPercent(deterministicUnit(index + 1) * 100),
    top: formatPercent(deterministicUnit(index + 101) * 100),
    animationDelay: formatSeconds(deterministicUnit(index + 201) * 5),
    animationDuration: formatSeconds(5 + deterministicUnit(index + 301) * 10),
  }))
}

const STATIC_PARTICLES = createStaticParticles(15)

type NolanHeroBannerProps = {
  transparent?: boolean
}

export function NolanHeroBanner({ transparent = false }: NolanHeroBannerProps) {
  const { resolvedTheme } = useThemeContext()
  const isDark = resolvedTheme === 'dark'
  const nolanLogoSrc = '/logo_dark_nolanx.png'
  const [glitchActive, setGlitchActive] = useState(false)
  const [mosaics, setMosaics] = useState<Mosaic[]>([])
  const mosaicIdCounterRef = useRef(0)
  const removalTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const t = useTranslations("Nolan")
  const labelText = t("heroBanner.label")
  const nameText = t("heroBanner.name")
  const worldFirstText = t("heroBanner.worldFirst")
  const aiAgentDirectorText = t("heroBanner.aiAgentDirector")

  useEffect(() => {
    // Random glitch effect
    const interval = setInterval(() => {
      setGlitchActive(true)
      setTimeout(() => setGlitchActive(false), 1260)
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Continuously add random mosaics at random intervals
    let timeoutId: NodeJS.Timeout

    const addRandomMosaic = () => {
      const newMosaic: Mosaic = {
        id: mosaicIdCounterRef.current++,
        x: Math.random() * 100, // Random position across entire width
        y: Math.random() * 100, // Random position across entire height
        size: 6 + Math.random() * 10, // 6-16px
        delay: 0,
        duration: 2 + Math.random() * 2, // 2-4s
      }

      setMosaics(prev => [...prev, newMosaic])

      // Remove mosaic after animation completes
      const removalTimeoutId = setTimeout(() => {
        setMosaics(prev => prev.filter(m => m.id !== newMosaic.id))
      }, (newMosaic.duration + 0.5) * 1000)
      removalTimeoutsRef.current.push(removalTimeoutId)

      // Schedule next mosaic at random interval (200ms - 800ms)
      const nextInterval = 200 + Math.random() * 600
      timeoutId = setTimeout(addRandomMosaic, nextInterval)
    }

    // Start the cycle
    addRandomMosaic()

    return () => {
      clearTimeout(timeoutId)
      removalTimeoutsRef.current.forEach(clearTimeout)
      removalTimeoutsRef.current = []
    }
  }, [])

  return (
    <div className="relative w-full max-w-[70.4rem] mx-auto my-8 px-4 md:px-6 lg:px-8">
      {/* Main container with perspective */}
      <div className="relative perspective-1000">
        {/* Holographic background layer */}
        <div className={`absolute inset-0 rounded-xl overflow-hidden ${transparent ? 'opacity-0' : 'opacity-30'}`}>
          <div className="absolute inset-0 bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 animate-gradient-x blur-xl" />
        </div>

        {/* Main content card */}
        <div className={`
          relative rounded-xl overflow-hidden
          ${transparent
            ? 'bg-transparent'
            : isDark
            ? 'bg-gradient-to-br from-gray-900/90 via-black/95 to-gray-900/90'
            : 'bg-gradient-to-br from-white/90 via-gray-50/95 to-white/90'
          }
          ${transparent ? 'backdrop-blur-0 shadow-none' : 'backdrop-blur-xl shadow-2xl'}
        `}>
          {/* Animated grid background */}
          <div className={`absolute inset-0 ${transparent ? 'opacity-0' : 'opacity-20'}`}>
            <div className={`
              absolute inset-0
              ${isDark 
                ? 'bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)]' 
                : 'bg-[linear-gradient(rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.05)_1px,transparent_1px)]'
              }
              bg-[size:40px_40px]
              animate-grid-flow
            `} />
          </div>

          {/* Mosaic clusters effect - like snowflakes */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {mosaics.map((mosaic) => (
              <div
                key={mosaic.id}
                className="absolute bg-orange-500/30 dark:bg-orange-400/30 animate-mosaic-float"
                style={{
                  left: `${mosaic.x}%`,
                  top: `${mosaic.y}%`,
                  width: `${mosaic.size}px`,
                  height: `${mosaic.size}px`,
                  animationDelay: `${mosaic.delay}s`,
                  animationDuration: `${mosaic.duration}s`,
                }}
              />
            ))}
          </div>

          {/* Content wrapper */}
          <div className="relative px-6 py-6 md:px-8 md:py-8">
            {/* Top label */}
            <div className="flex justify-center mb-3">
              <div className={`
                inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 md:gap-2 md:px-3 rounded-full
                ${isDark
                  ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30'
                  : 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30'
                }
                backdrop-blur-sm
              `}>
                <div className="w-2 h-2 rounded-full animate-pulse bg-orange-500" />
                <span className="whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-black md:text-xs md:tracking-wider">
                  {labelText}
                </span>
              </div>
            </div>

            {/* Main title with glitch effect - Two lines */}
            <div className="relative flex flex-col items-center gap-3">
              {/* Line 1: Nolan signature */}
              <div className="relative">
                <div className="relative inline-block">
                  <div
                    className={`
                      relative z-10 text-4xl md:text-5xl lg:text-6xl font-black
                      tracking-[0.04em]
                      ${glitchActive ? 'nolan-logo-glitch' : ''}
                    `}
                    style={{
                      textShadow: transparent
                        ? '0 12px 42px rgba(0, 0, 0, 0.82), 0 0 28px rgba(249, 115, 22, 0.34)'
                        : isDark
                        ? '0 0 18px rgba(249, 115, 22, 0.35), 0 0 36px rgba(251, 146, 60, 0.18)'
                        : '0 0 14px rgba(249, 115, 22, 0.22), 0 0 28px rgba(251, 146, 60, 0.12)'
                    }}
                  >
                    <Image
                      src={nolanLogoSrc}
                      alt={nameText}
                      width={512}
                      height={155}
                      priority
                      className="h-auto w-[min(42vw,18rem)] object-contain"
                    />
                  </div>
                  <div className="absolute -bottom-1 left-0 right-0 h-1 overflow-hidden">
                    <div className={`h-full w-full ${transparent || isDark ? 'bg-white' : 'bg-black'}`} />
                  </div>
                  {glitchActive && (
                    <>
                      <span className="nolan-logo-glitch-layer nolan-logo-glitch-white absolute inset-0 pointer-events-none">
                        <Image
                          src={nolanLogoSrc}
                          alt=""
                          width={512}
                          height={155}
                          className="h-auto w-[min(42vw,18rem)] object-contain"
                        />
                      </span>
                      <span className="nolan-logo-glitch-layer nolan-logo-glitch-black absolute inset-0 pointer-events-none">
                        <Image
                          src={nolanLogoSrc}
                          alt=""
                          width={512}
                          height={155}
                          className="h-auto w-[min(42vw,18rem)] object-contain"
                        />
                      </span>
                      <span className="nolan-logo-glitch-layer nolan-logo-glitch-orange absolute inset-0 pointer-events-none">
                        <Image
                          src={nolanLogoSrc}
                          alt=""
                          width={512}
                          height={155}
                          className="h-auto w-[min(42vw,18rem)] object-contain"
                        />
                      </span>
                      <span className="nolan-logo-glitch-layer nolan-logo-glitch-deep-orange absolute inset-0 pointer-events-none">
                        <Image
                          src={nolanLogoSrc}
                          alt=""
                          width={512}
                          height={155}
                          className="h-auto w-[min(42vw,18rem)] object-contain"
                        />
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Line 2: The World's First AI Agent Director */}
              <h1 className={`
                flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0 md:flex-nowrap md:gap-x-2
                whitespace-normal md:whitespace-nowrap
                ${transparent ? 'text-[clamp(2.4rem,11vw,4.8rem)] md:text-[clamp(8.5rem,22vw,24rem)]' : 'text-[clamp(4rem,12vw,24rem)]'}
                font-black text-center
                leading-[0.92] tracking-[0.05em]
                ${transparent || isDark ? 'text-white' : 'text-black'}
                ${transparent ? 'drop-shadow-[0_18px_54px_rgba(0,0,0,0.82)]' : ''}
                transition-all duration-200
              `}>
                <span className="relative inline-block">
                  <span className="relative z-10 text-orange-500">
                    {worldFirstText}
                  </span>
                </span>
                <span className="relative inline-block">
                  <span className={`
                    relative z-10 inline-block
                    ${transparent || isDark ? 'text-white' : 'text-black'}
                    font-bold tracking-normal
                  `}>
                    {aiAgentDirectorText}
                  </span>
                </span>
              </h1>
            </div>

            {/* Decorative corner elements */}
            <div className="absolute top-3 left-3 w-6 h-6">
              <div className={`absolute inset-0 border-l-2 border-t-2 rounded-tl-lg border-orange-500/50 ${transparent ? 'opacity-0' : ''}`} />
            </div>
            <div className="absolute top-3 right-3 w-6 h-6">
              <div className={`absolute inset-0 border-r-2 border-t-2 rounded-tr-lg border-amber-500/50 ${transparent ? 'opacity-0' : ''}`} />
            </div>
            <div className="absolute bottom-3 left-3 w-6 h-6">
              <div className={`absolute inset-0 border-l-2 border-b-2 rounded-bl-lg border-amber-500/50 ${transparent ? 'opacity-0' : ''}`} />
            </div>
            <div className="absolute bottom-3 right-3 w-6 h-6">
              <div className={`absolute inset-0 border-r-2 border-b-2 rounded-br-lg border-orange-500/50 ${transparent ? 'opacity-0' : ''}`} />
            </div>
          </div>

          {/* Outer glow effect */}
          <div className={`absolute inset-0 rounded-xl shadow-[0_0_50px_rgba(249,115,22,0.3),0_0_100px_rgba(251,146,60,0.2)] pointer-events-none ${transparent ? 'opacity-0' : ''}`} />
        </div>
      </div>

      {/* Floating particles effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {STATIC_PARTICLES.map((particle) => (
          <div
            key={particle.id}
            className="absolute w-1 h-1 rounded-full bg-orange-500/30 animate-float"
            style={{
              left: particle.left,
              top: particle.top,
              animationDelay: particle.animationDelay,
              animationDuration: particle.animationDuration,
            }}
          />
        ))}
      </div>
    </div>
  )
}
