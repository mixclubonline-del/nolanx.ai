import { NextResponse } from 'next/server';
import { getAppUrl } from '@/i18n/seo';

export const revalidate = 3600;

export async function GET() {
  const baseUrl = getAppUrl();
  const urls = [
    `${baseUrl}/`,
    `${baseUrl}/nolanx`,
    `${baseUrl}/canvas`,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n') +
    `\n</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
