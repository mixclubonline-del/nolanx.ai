import { defineRouting } from 'next-intl/routing';

import { defaultLocale, locales, localePrefix } from './routing';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix,
  localeCookie: {
    name: 'rm_locale',
    sameSite: 'lax',
    path: '/',
  },
});

