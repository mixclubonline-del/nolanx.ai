export function formatDate(isoString: string, locale: string = 'en'): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

