import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getAppLocale } from "@/i18n/server-locale";
import { getAppMessages } from "@/i18n/messages";
import { getAppUrl } from "@/i18n/seo";
import { isNolanxSite } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Nolan.meta");
  const title = t("title");
  const description = t("description");
  const canonical = new URL(isNolanxSite() ? "/" : "/nolanx", getAppUrl()).toString();

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: "NolanX",
      images: ["/og-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default async function NolanxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getAppLocale();
  const messages = await getAppMessages(locale, true);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
