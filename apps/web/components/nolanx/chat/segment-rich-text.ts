export type RichTextSegment =
  | { type: 'markdown'; content: string }
  | { type: 'json'; raw: string; value: unknown; canonical: string; repeat: number }

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function isEmptyJsonContainer(value: Record<string, unknown> | unknown[]): boolean {
  if (Array.isArray(value)) return value.length === 0
  return Object.keys(value).length === 0
}

function pushMarkdown(out: RichTextSegment[], content: string) {
  if (!content || !content.trim()) return
  const prev = out[out.length - 1]
  if (prev?.type === 'markdown') {
    prev.content += content
    return
  }
  out.push({ type: 'markdown', content })
}

function pushJson(out: RichTextSegment[], raw: string, value: unknown) {
  const canonical = JSON.stringify(value)
  const prev = out[out.length - 1]
  if (prev?.type === 'json' && prev.canonical === canonical) {
    prev.repeat += 1
    return
  }
  out.push({ type: 'json', raw, value, canonical, repeat: 1 })
}

type JsonMatch = {
  raw: string
  value: unknown
  endIndex: number
}

function findJsonMatchAt(input: string, startIndex: number): JsonMatch | null {
  const first = input[startIndex]
  if (first !== '{' && first !== '[') return null

  let depth = 0
  let inString = false
  let isEscaped = false

  for (let i = startIndex; i < input.length; i++) {
    const ch = input[i]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (ch === '\\') {
        isEscaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      depth += 1
      continue
    }

    if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) {
        const raw = input.slice(startIndex, i + 1)
        try {
          const value = JSON.parse(raw)
          if (!isJsonContainer(value)) return null
          return { raw, value, endIndex: i }
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function segmentPlainText(input: string, { allowEmpty }: { allowEmpty: boolean }): RichTextSegment[] {
  const out: RichTextSegment[] = []
  let cursor = 0

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch !== '{' && ch !== '[') continue

    const match = findJsonMatchAt(input, i)
    if (!match) continue

    const value = match.value as Record<string, unknown> | unknown[]
    if (!allowEmpty && isEmptyJsonContainer(value)) {
      continue
    }

    pushMarkdown(out, input.slice(cursor, i))
    pushJson(out, match.raw, match.value)
    cursor = match.endIndex + 1
    i = match.endIndex
  }

  pushMarkdown(out, input.slice(cursor))
  return out
}

function mergeAdjacentMarkdown(segments: RichTextSegment[]): RichTextSegment[] {
  const out: RichTextSegment[] = []
  for (const seg of segments) {
    if (seg.type === 'markdown') {
      pushMarkdown(out, seg.content)
      continue
    }
    out.push(seg)
  }
  return out
}

export function segmentRichText(input: string): RichTextSegment[] {
  const out: RichTextSegment[] = []

  const fenceRegex = /```([a-zA-Z0-9_-]+)?[ \t]*\n?([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = fenceRegex.exec(input)) !== null) {
    const before = input.slice(cursor, match.index)
    if (before) {
      out.push(...segmentPlainText(before, { allowEmpty: false }))
    }

    const lang = String(match[1] || '').toLowerCase()
    const code = String(match[2] || '').trim()
    if (lang === 'json' || lang === 'application/json') {
      try {
        const value = JSON.parse(code)
        if (isJsonContainer(value)) {
          pushJson(out, code, value)
        } else {
          pushMarkdown(out, match[0])
        }
      } catch {
        pushMarkdown(out, match[0])
      }
    } else {
      // Keep non-JSON code fences as markdown; do not try to parse JSON inside them.
      pushMarkdown(out, match[0])
    }

    cursor = fenceRegex.lastIndex
  }

  const rest = input.slice(cursor)
  if (rest) {
    out.push(...segmentPlainText(rest, { allowEmpty: false }))
  }

  return mergeAdjacentMarkdown(out)
}
