export const locales = [
  'en',
  'zh-CN',
  'hi-IN',
  'es-ES',
  'pt-BR',
  'id-ID',
  'ar-SA',
  'ru-RU',
  'ja-JP',
  'de-DE',
  'fr-FR',
  'tr-TR',
  'ko-KR',
  'vi-VN',
  'it-IT',
  'th-TH',
  'pl-PL',
  'nl-NL',
  'bn-BD',
  'fa-IR',
] as const;

export type AppLocale = (typeof locales)[number];

export const localePrefix = 'never' as const;

export const defaultLocale: AppLocale = 'en';

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  if (!value) return false;
  return (locales as readonly string[]).includes(value);
}
