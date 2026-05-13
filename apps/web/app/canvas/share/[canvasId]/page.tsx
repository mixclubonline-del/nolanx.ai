"use client";

import { Suspense, use } from "react";
import { NolanxCanvas } from "@/components/nolanx/canvas/NolanxCanvas";
import { NolanCanvasLoader } from "@/components/nolanx/canvas/NolanCanvasLoader";
import { useTranslations } from "next-intl";

interface CanvasSharePageProps {
  params: Promise<{
    canvasId: string;
  }>;
}

export default function CanvasShare({ params }: CanvasSharePageProps) {
  const { canvasId } = use(params);
  const t = useTranslations("Nolanx.canvas");

  return (
    <div className="h-screen w-full">
      <Suspense fallback={
        <NolanCanvasLoader
          title={t("loading.loadingSharedCanvas")}
          subtitle="Hydrating shared canvas state and replay context."
        />
      }>
        <NolanxCanvas canvasId={canvasId} isShared={true} />
      </Suspense>
    </div>
  );
}
