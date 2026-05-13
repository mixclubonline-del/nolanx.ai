export interface SiteConfig {
  variant: 'nolanx';
  name: string;
  title: string;
  titleTemplate: string;
  description: string;
  appUrl: string;
  apiBaseUrl: string;
  websocketUrl: string;
  ogImage: string;
}

const DEFAULT_SITE_CONFIG: SiteConfig = {
  variant: 'nolanx',
  name: 'NolanX',
  title: 'NolanX - AI Director for cinematic video creation',
  titleTemplate: '%s | NolanX',
  description:
    'NolanX is the AI director for creators to craft cinematic videos, remix ideas, and share next-gen visuals with ease.',
  appUrl: 'https://nolanx.ai',
  apiBaseUrl: 'https://api.nolanx.ai',
  websocketUrl: 'wss://ws.nolanx.ai',
  ogImage: '/og-image.png',
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function isNolanxHostname(hostname: string | undefined): boolean {
  const normalized = (hostname ?? '').split(',')[0]?.trim().split(':')[0]?.toLowerCase() ?? '';
  return normalized === 'nolanx.ai' || normalized === 'www.nolanx.ai' || normalized === 'localhost';
}

export function isNolanxSite(): boolean {
  return true;
}

export function getSiteConfig(): SiteConfig {
  return {
    ...DEFAULT_SITE_CONFIG,
    appUrl: trimTrailingSlash(process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_SITE_CONFIG.appUrl),
    apiBaseUrl: trimTrailingSlash(process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_SITE_CONFIG.apiBaseUrl),
    websocketUrl: trimTrailingSlash(process.env.NEXT_PUBLIC_WS_SERVER_URL ?? DEFAULT_SITE_CONFIG.websocketUrl),
  };
}

export function getCurrentAppUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return getSiteConfig().appUrl;
}
