import type { Metadata } from "next";

import { defaultLocale } from "@/i18n/routing";
import { getAppUrl, getCanonicalUrl } from "@/i18n/seo";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getAppUrl();
  const canonical = getCanonicalUrl(defaultLocale, "/canvas", baseUrl);

  return {
    alternates: { canonical },
    robots: { index: false, follow: true },
  };
}
