import { getRequestConfig } from 'next-intl/server';

import { defaultLocale, isAppLocale } from './routing';
import { getAppMessages } from './messages';

export default getRequestConfig(async ({requestLocale}) => {
  const candidate = await requestLocale;
  const locale = isAppLocale(candidate) ? candidate : defaultLocale;

  return {
    locale,
    messages: await getAppMessages(locale, false),
  };
});
