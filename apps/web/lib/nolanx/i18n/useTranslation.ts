import { useLocale, useTranslations } from 'next-intl'

type TranslationValues = Record<string, unknown>

type NolanxI18n = {
  language: string
}

function normalizeNolanxKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return trimmed

  const [nsOrKey, rest] = trimmed.includes(':')
    ? (trimmed.split(/:(.+)/) as [string, string])
    : (['common', trimmed] as [string, string])

  const ns = (nsOrKey || 'common').trim()
  const path = (rest || '').trim().replace(/:/g, '.')
  if (!path) return `Nolanx.${ns}`

  return `Nolanx.${ns}.${path}`
}

/**
 * next-intl based replacement for `react-i18next`'s `useTranslation`.
 *
 * - Keeps compatibility with i18next key format: `canvas:back` / `settings:provider.title`
 * - Defaults to `common` namespace when no namespace is provided
 */
export function useTranslation() {
  const tRoot = useTranslations()
  const locale = useLocale()

  const t = (key: string, values?: TranslationValues) => {
    const normalizedKey = normalizeNolanxKey(key)
    try {
      return tRoot(normalizedKey, values as any)
    } catch {
      // Avoid crashing UI on missing keys; fall back to the raw key.
      const fallback = values && typeof (values as any).defaultValue === 'string' ? (values as any).defaultValue : undefined
      return fallback ?? key
    }
  }

  const i18n: NolanxI18n = { language: locale }

  return { t, i18n }
}
