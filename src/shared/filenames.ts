import sanitizeFilename from 'sanitize-filename'
import { extension as lookupExtension } from 'mime-types'

export function buildSafeFilename(
  filename: string | null,
  baseName: string,
  contentType?: string
): string {
  const cleaned = sanitizeFilename(filename ?? '').trim()
  if (cleaned) {
    return cleaned
  }

  const ext = contentType ? lookupExtension(contentType) : false
  return ext ? `${baseName}.${ext}` : baseName
}
