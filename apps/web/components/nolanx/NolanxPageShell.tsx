"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { CinematicWrapper } from "@/components/ui/cinematic-wrapper";
import { NolanxApp } from "@/components/nolanx/NolanxApp";

export function NolanxPageShell() {
  const t = useTranslations("Nolan");

  return (
    <CinematicWrapper className="h-screen w-full" animation="fade">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full cinematic-bg">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin cinematic-text-accent" />
              <p className="text-nolan-text-muted dark:text-gray-300 text-lg">{t("page.loading")}</p>
            </div>
          </div>
        }
      >
        <NolanxApp />
      </Suspense>
    </CinematicWrapper>
  );
}
