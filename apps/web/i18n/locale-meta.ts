import type { AppLocale } from './routing';

export type LocaleMeta = {
  locale: AppLocale;
  language: string;
  nativeLanguage: string;
  country: string;
};

export const TOP_20_TITLE_LOCALES: readonly LocaleMeta[] = [
  { locale: 'en', language: 'English', nativeLanguage: 'English', country: 'United States' },
  { locale: 'zh-CN', language: 'Chinese (Simplified)', nativeLanguage: '简体中文', country: 'China' },
  { locale: 'hi-IN', language: 'Hindi', nativeLanguage: 'हिन्दी', country: 'India' },
  { locale: 'es-ES', language: 'Spanish', nativeLanguage: 'Español', country: 'Spain' },
  { locale: 'pt-BR', language: 'Portuguese (Brazil)', nativeLanguage: 'Português', country: 'Brazil' },
  { locale: 'id-ID', language: 'Indonesian', nativeLanguage: 'Bahasa Indonesia', country: 'Indonesia' },
  { locale: 'ar-SA', language: 'Arabic', nativeLanguage: 'العربية', country: 'Saudi Arabia' },
  { locale: 'ru-RU', language: 'Russian', nativeLanguage: 'Русский', country: 'Russia' },
  { locale: 'ja-JP', language: 'Japanese', nativeLanguage: '日本語', country: 'Japan' },
  { locale: 'de-DE', language: 'German', nativeLanguage: 'Deutsch', country: 'Germany' },
  { locale: 'fr-FR', language: 'French', nativeLanguage: 'Français', country: 'France' },
  { locale: 'tr-TR', language: 'Turkish', nativeLanguage: 'Türkçe', country: 'Turkey' },
  { locale: 'ko-KR', language: 'Korean', nativeLanguage: '한국어', country: 'South Korea' },
  { locale: 'vi-VN', language: 'Vietnamese', nativeLanguage: 'Tiếng Việt', country: 'Vietnam' },
  { locale: 'it-IT', language: 'Italian', nativeLanguage: 'Italiano', country: 'Italy' },
  { locale: 'th-TH', language: 'Thai', nativeLanguage: 'ไทย', country: 'Thailand' },
  { locale: 'pl-PL', language: 'Polish', nativeLanguage: 'Polski', country: 'Poland' },
  { locale: 'nl-NL', language: 'Dutch', nativeLanguage: 'Nederlands', country: 'Netherlands' },
  { locale: 'bn-BD', language: 'Bengali', nativeLanguage: 'বাংলা', country: 'Bangladesh' },
  { locale: 'fa-IR', language: 'Persian', nativeLanguage: 'فارسی', country: 'Iran' },
] as const;

