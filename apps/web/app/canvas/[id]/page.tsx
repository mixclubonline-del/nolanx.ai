"use client";

import { Suspense, use } from "react";
import { NolanxCanvas } from "@/components/nolanx/canvas/NolanxCanvas";
import { NolanCanvasLoader } from "@/components/nolanx/canvas/NolanCanvasLoader";
import { useTranslations } from "next-intl";

interface CanvasPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function CanvasPage({ params }: CanvasPageProps) {
  const { id } = use(params);
  const t = useTranslations("Nolanx.canvas");

  return (
    <div className="h-screen w-full overflow-hidden">
      <Suspense fallback={
        <NolanCanvasLoader
          title={t("loading.preparingCanvas")}
          subtitle="Hydrating sessions, timeline tracks, and live runtime state."
        />
      }>
        <NolanxCanvas canvasId={id} />
      </Suspense>
    </div>
  );
}
