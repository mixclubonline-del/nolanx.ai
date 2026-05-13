export function looksLikeStructuredOutput(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  return (
    /"screenplay"\s*:/.test(trimmed) ||
    /"story_metrics"\s*:/.test(trimmed) ||
    /"visual_bible"\s*:/.test(trimmed) ||
    /"bible"\s*:/.test(trimmed) ||
    (/[\{\}\[\]]/.test(trimmed) && trimmed.includes('"') && trimmed.includes(':'))
  )
}

export function shouldFoldChatMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const lineCount = trimmed.split('\n').filter(Boolean).length
  const largeStructured = looksLikeStructuredOutput(trimmed) && (trimmed.length > 500 || lineCount > 10)
  const veryLongPlain = trimmed.length > 1800 || lineCount > 28

  return largeStructured || veryLongPlain
}

export function getFoldLabel(text: string): string {
  const trimmed = text.trim()
  if (
    /"screenplay"\s*:/.test(trimmed) ||
    /"visual_bible"\s*:/.test(trimmed) ||
    /"story_metrics"\s*:/.test(trimmed) ||
    /"bible"\s*:/.test(trimmed)
  ) {
    return 'Structured Output'
  }

  if (/^EXT\.|^INT\./m.test(trimmed)) {
    return 'Script Output'
  }

  return 'Long Message'
}
