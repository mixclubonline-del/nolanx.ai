import { localizePathname } from './pathname';
import { defaultLocale, type AppLocale } from './routing';
import { getSiteConfig } from '@/lib/site';

export function getAppUrl() {
  return getSiteConfig().appUrl;
}

export function getCanonicalUrl(locale: AppLocale, pathname: string, baseUrl: string = getAppUrl()) {
  return new URL(localizePathname(pathname, locale), baseUrl).toString();
}
