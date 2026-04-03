export interface ParsedHeaders {
  raw: Record<string, string>
  contentType: string | null
  contentDisposition: string | null
  contentTransferEncoding: string | null
}

export interface ParsedHeaderValue {
  value: string
  params: Record<string, string>
}

export function parseHeaderBlock(lines: string[]): ParsedHeaders {
  const merged: string[] = []

  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && merged.length > 0) {
      merged[merged.length - 1] += ` ${line.trim()}`
    } else {
      merged.push(line.trimEnd())
    }
  }

  const raw: Record<string, string> = {}
  for (const line of merged) {
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }

    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    raw[key] = raw[key] ? `${raw[key]}, ${value}` : value
  }

  return {
    raw,
    contentType: raw['content-type'] ?? null,
    contentDisposition: raw['content-disposition'] ?? null,
    contentTransferEncoding: raw['content-transfer-encoding'] ?? null
  }
}

export function parseHeaderValue(header: string | null): ParsedHeaderValue {
  if (!header) {
    return { value: '', params: {} }
  }

  const segments = header.split(';')
  const value = segments.shift()?.trim().toLowerCase() ?? ''
  const params: Record<string, string> = {}

  for (const segment of segments) {
    const equals = segment.indexOf('=')
    if (equals === -1) {
      continue
    }

    const key = segment.slice(0, equals).trim().toLowerCase().replace(/\*$/, '')
    const rawValue = segment
      .slice(equals + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
    params[key] = rawValue
  }

  return { value, params }
}

export function getMultipartBoundary(
  contentType: string | null
): string | null {
  const parsed = parseHeaderValue(contentType)
  if (!parsed.value.startsWith('multipart/')) {
    return null
  }

  return parsed.params.boundary ?? null
}

export function isAttachmentPart(headers: ParsedHeaders): boolean {
  const disposition = parseHeaderValue(headers.contentDisposition)
  const contentType = parseHeaderValue(headers.contentType)

  if (disposition.value === 'attachment') {
    return true
  }

  if (disposition.params.filename || contentType.params.name) {
    return true
  }

  return (
    disposition.value === 'inline' &&
    Boolean(disposition.params.filename || contentType.params.name)
  )
}

export function getAttachmentFilename(headers: ParsedHeaders): string | null {
  const disposition = parseHeaderValue(headers.contentDisposition)
  const contentType = parseHeaderValue(headers.contentType)

  return disposition.params.filename ?? contentType.params.name ?? null
}
