import { getLocale } from 'next-intl/server';

import { defaultLocale, isAppLocale, type AppLocale } from './routing';

export async function getAppLocale(): Promise<AppLocale> {
  const candidate = await getLocale();
  return isAppLocale(candidate) ? candidate : defaultLocale;
}

