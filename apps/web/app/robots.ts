import { MetadataRoute } from 'next';
import { getSiteConfig } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  const siteConfig = getSiteConfig();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin', '/admin/', '/payment/', '/upload/', '/profile/edit'],
    },
    sitemap: `${siteConfig.appUrl}/sitemap.xml`,
  };
}
