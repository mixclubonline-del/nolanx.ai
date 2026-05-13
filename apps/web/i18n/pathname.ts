import { defaultLocale, isAppLocale, localePrefix, type AppLocale } from './routing';

export function getLocaleFromPathname(pathname: string): AppLocale | null {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const first = normalized.split('/')[1] ?? '';
  return isAppLocale(first) ? first : null;
}

export function stripLocalePrefix(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const locale = getLocaleFromPathname(normalized);
  if (!locale) return normalized;

  const rest = normalized.slice(`/${locale}`.length);
  return rest === '' ? '/' : rest;
}

export function localizePathname(pathname: string, locale: AppLocale): string {
  const normalized = stripLocalePrefix(pathname);

  if (localePrefix === 'never') return normalized;
  if (locale === defaultLocale) return normalized;
  if (normalized === '/') return `/${locale}`;
  return `/${locale}${normalized}`;
}

