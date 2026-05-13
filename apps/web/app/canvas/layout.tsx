import { NextIntlClientProvider } from "next-intl";
import { getAppLocale } from "@/i18n/server-locale";
import { getAppMessages } from "@/i18n/messages";
import { CanvasProviders } from "./canvas-providers";

export { generateMetadata } from "./metadata";

export default async function CanvasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getAppLocale();
  const messages = await getAppMessages(locale, true);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CanvasProviders>{children}</CanvasProviders>
    </NextIntlClientProvider>
  );
}

