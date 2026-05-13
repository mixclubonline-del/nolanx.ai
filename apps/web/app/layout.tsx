import './globals.css'
import '../styles/mobile-styles.css'
import '../styles/coming-soon-animations.css'
import { ThemeContextProvider } from '@/contexts/theme-context';
import { Toaster } from '@/components/ui/sonner';
import { QueryProvider } from '@/providers/query-provider';
import { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import { DynamicLayout } from '@/components/layout/dynamic-layout';
import { NextIntlClientProvider } from 'next-intl';
import { getAppLocale } from '@/i18n/server-locale';
import { getAppMessages } from '@/i18n/messages';
import { getSiteConfig } from '@/lib/site';

const siteConfig = getSiteConfig();

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: {
    default: siteConfig.title,
    template: siteConfig.titleTemplate,
  },
  description: siteConfig.description,
  keywords: ['NolanX', 'AI video', 'canvas', 'agent', 'cinematic workflow'],
  authors: [{ name: `${siteConfig.name} Team` }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL(siteConfig.appUrl),
  openGraph: {
    type: 'website',
    url: siteConfig.appUrl,
    title: siteConfig.title,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.title,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getAppLocale();
  const messages = await getAppMessages(locale, true);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`overflow-x-hidden ${montserrat.className}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeContextProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>
              <DynamicLayout>{children}</DynamicLayout>
              <Toaster />
            </QueryProvider>
          </ThemeContextProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
