import type { SearchFilters } from './contracts'

const TOKEN_PATTERN = /"([^"]+)"|(\S+)/gu
const FILE_EXTENSION_PATTERN =
  /\.(pdf|png|jpe?g|docx?|xlsx?|csv|zip|eml|msg|txt)$/i
const ATTACHMENT_INTENT_TERMS = new Set([
  'attachment',
  'attachments',
  'attached',
  'bank',
  'bill',
  'certificate',
  'contract',
  'cv',
  'document',
  'documents',
  'docs',
  'driver',
  'id',
  'identity',
  'invoice',
  'licence',
  'license',
  'passport',
  'payslip',
  'pdf',
  'receipt',
  'resume',
  'scan',
  'scanned',
  'statement',
  'tax',
  'visa',
  'w2',
  'w9'
])

export interface ParsedSearchInput {
  text: string
  filters: Partial<SearchFilters>
  preferAttachments: boolean
}

export function buildFtsMatchQuery(input: string): string | null {
  const tokens = [...input.matchAll(TOKEN_PATTERN)]
    .map((match) => sanitizeSearchToken(match[1] ?? match[2] ?? ''))
    .flat()

  if (tokens.length === 0) {
    return null
  }

  return tokens.map(quoteFtsPhrase).join(' AND ')
}

export function parseSearchInput(input: string): ParsedSearchInput {
  const tokens = [...input.matchAll(TOKEN_PATTERN)].map(
    (match) => match[1] ?? match[2] ?? ''
  )
  const textTokens: string[] = []
  const filters: Partial<SearchFilters> = {}
  let preferAttachments = false

  for (const rawToken of tokens) {
    const token = rawToken.trim()
    const separator = token.indexOf(':')
    if (separator <= 0) {
      textTokens.push(token)
      continue
    }

    const key = token.slice(0, separator).toLowerCase()
    const rawValue = token.slice(separator + 1).trim()
    if (!rawValue) {
      textTokens.push(token)
      continue
    }

    if (key === 'from') {
      filters.sender = joinSearchFragments(filters.sender, rawValue)
      continue
    }

    if (key === 'has' && /^(attachment|attachments)$/i.test(rawValue)) {
      filters.hasAttachments = true
      preferAttachments = true
      continue
    }

    if (key === 'after') {
      const normalized = normalizeDateToken(rawValue)
      if (normalized) {
        filters.dateFrom = normalized
        continue
      }
    }

    if (key === 'before') {
      const normalized = normalizeDateToken(rawValue)
      if (normalized) {
        filters.dateTo = shiftLocalDate(normalized, -1)
        continue
      }
    }

    if (key === 'filename' || key === 'filetype') {
      textTokens.push(rawValue)
      preferAttachments = true
      if (key === 'filetype') {
        filters.hasAttachments = true
      }
      continue
    }

    textTokens.push(token)
  }

  return {
    text: textTokens.join(' ').trim(),
    filters,
    preferAttachments: preferAttachments || detectAttachmentSearchIntent(input)
  }
}

export function extractSearchTerms(input: string): string[] {
  return [...input.matchAll(TOKEN_PATTERN)]
    .map((match) => sanitizeSearchToken(match[1] ?? match[2] ?? ''))
    .flat()
}

export function detectAttachmentSearchIntent(input: string): boolean {
  const tokens = [...input.matchAll(TOKEN_PATTERN)].map((match) =>
    (match[1] ?? match[2] ?? '').trim().toLowerCase()
  )

  if (
    tokens.some(
      (token) =>
        token.startsWith('filename:') ||
        token.startsWith('filetype:') ||
        token === 'has:attachment' ||
        token === 'has:attachments'
    )
  ) {
    return true
  }

  const normalized = tokens.flatMap((token) => sanitizeSearchToken(token))
  if (normalized.some((token) => FILE_EXTENSION_PATTERN.test(`.${token}`))) {
    return true
  }

  return normalized.some(
    (token) =>
      ATTACHMENT_INTENT_TERMS.has(token) || FILE_EXTENSION_PATTERN.test(token)
  )
}

export function localDateStartToIso(value: string): string | null {
  return localDateToIsoBoundary(value, 'start')
}

export function localDateEndToIso(value: string): string | null {
  return localDateToIsoBoundary(value, 'end')
}

function sanitizeSearchToken(token: string): string[] {
  return token
    .replace(/[^\p{L}\p{N}@._+-]+/gu, ' ')
    .split(/\s+/)
    .map((part) => part.trim().replace(/^[._+-]+|[._+-]+$/gu, ''))
    .filter(Boolean)
}

function quoteFtsPhrase(token: string): string {
  return `"${token.replace(/"/g, '""')}"`
}

function joinSearchFragments(
  current: string | undefined,
  incoming: string
): string {
  if (!current) {
    return incoming
  }

  return `${current} ${incoming}`.trim()
}

function normalizeDateToken(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function shiftLocalDate(value: string, days: number): string {
  const candidate = new Date(`${value}T12:00:00.000`)
  if (Number.isNaN(candidate.getTime())) {
    return value
  }

  candidate.setDate(candidate.getDate() + days)
  return [
    candidate.getFullYear(),
    String(candidate.getMonth() + 1).padStart(2, '0'),
    String(candidate.getDate()).padStart(2, '0')
  ].join('-')
}

function localDateToIsoBoundary(
  value: string,
  boundary: 'start' | 'end'
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }

  const candidate = new Date(
    boundary === 'start' ? `${value}T00:00:00.000` : `${value}T23:59:59.999`
  )

  if (Number.isNaN(candidate.getTime())) {
    return null
  }

  return candidate.toISOString()
}
