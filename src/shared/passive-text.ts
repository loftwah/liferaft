import { compile } from 'html-to-text'

const MAX_HTML_CHARACTERS = 512 * 1024
const toText = compile({
  wordwrap: false,
  limits: { maxDepth: 64, maxChildNodes: 4096 },
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'iframe', format: 'skip' },
    { selector: 'svg', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'script', format: 'skip' }
  ]
})

export function passiveMessageText(text: string, html: string | null): string {
  if (text.trim() || !html || html.length > MAX_HTML_CHARACTERS) return text
  return toText(html)
}
