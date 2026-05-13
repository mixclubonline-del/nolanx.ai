import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getAppUrl } from '@/i18n/seo';
import { NolanxPageShell } from '@/components/nolanx/NolanxPageShell';

export const revalidate = 180;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Nolan.meta');
  const title = t('title');
  const description = t('description');
  const canonical = new URL('/', getAppUrl()).toString();

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: canonical,
      siteName: 'NolanX',
      images: ['/og-image.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-image.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-video-preview': -1,
        'max-snippet': -1,
      },
    },
  };
}

export default function Page() {
  return <NolanxPageShell />;
}
