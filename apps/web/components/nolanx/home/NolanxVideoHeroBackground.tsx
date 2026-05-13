"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

type NolanxVideoHeroBackgroundProps = {
  videos: string[];
};

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

export function NolanxVideoHeroBackground({ videos }: NolanxVideoHeroBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { elementRef, isInView } = useIntersectionObserver({
    threshold: 0.12,
    rootMargin: "160px",
  });
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const safeVideos = useMemo(() => videos.filter(Boolean), [videos]);
  const activeVideo = safeVideos[activeIndex % Math.max(safeVideos.length, 1)];
  const nextVideo = safeVideos[(activeIndex + 1) % Math.max(safeVideos.length, 1)];
  const shouldPlay = isInView && !prefersReducedMotion && Boolean(activeVideo);

  useEffect(() => {
    setIsReady(false);
  }, [activeVideo]);

  const playNextVideo = () => {
    if (safeVideos.length < 2) return;
    setActiveIndex((index) => (index + 1) % safeVideos.length);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!shouldPlay) {
      video.pause();
      return;
    }

    void video.play().catch(() => {
      // Autoplay can still be blocked in unusual browser states; keep the static fallback visible.
    });
  }, [activeVideo, shouldPlay]);

  if (!activeVideo) {
    return null;
  }

  return (
    <div ref={elementRef} className="absolute inset-0 overflow-hidden bg-[#050403]">
      <video
        key={activeVideo}
        ref={videoRef}
        className={[
          "absolute inset-0 h-full w-full scale-[1.02] object-cover",
          "transition-opacity duration-1000 ease-out",
          isReady && shouldPlay ? "opacity-100" : "opacity-0",
        ].join(" ")}
        src={shouldPlay ? activeVideo : undefined}
        muted
        playsInline
        autoPlay={shouldPlay}
        loop={safeVideos.length < 2}
        preload={shouldPlay ? "auto" : "none"}
        onCanPlay={() => setIsReady(true)}
        onEnded={playNextVideo}
      />

      {shouldPlay && safeVideos.length > 1 && nextVideo && (
        <video
          aria-hidden="true"
          className="pointer-events-none absolute size-px opacity-0"
          src={nextVideo}
          muted
          playsInline
          preload="metadata"
        />
      )}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.20)_0%,rgba(0,0,0,0.54)_58%,rgba(0,0,0,0.92)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.58),transparent_24%,transparent_76%,rgba(0,0,0,0.58))]" />
      <div className="absolute inset-x-0 bottom-0 h-[34rem] bg-gradient-to-b from-transparent via-[#050403]/62 to-[#050403]" />
    </div>
  );
}
