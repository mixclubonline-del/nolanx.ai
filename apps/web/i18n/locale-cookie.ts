import type { AppLocale } from './routing';

export const LOCALE_COOKIE_NAME = 'rm_locale';

export function setLocaleCookie(locale: AppLocale) {
  if (typeof document === 'undefined') return;

  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const maxAgeSeconds = 60 * 60 * 24 * 365; // 1 year

  const parts = [
    `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];

  if (isSecure) parts.push('Secure');

  document.cookie = parts.join('; ');
}

