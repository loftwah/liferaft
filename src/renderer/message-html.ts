import DOMPurify from 'dompurify'

// Mail is untrusted content inside the application's renderer. Preserve readable
// structure, never email CSS, controls, navigation or resource requests.
export function sanitiseMessageHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a',
      'abbr',
      'b',
      'bdi',
      'bdo',
      'blockquote',
      'br',
      'caption',
      'code',
      'dd',
      'del',
      'div',
      'dl',
      'dt',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'ins',
      'li',
      'ol',
      'p',
      'pre',
      'q',
      's',
      'small',
      'span',
      'strong',
      'sub',
      'sup',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tfoot',
      'tr',
      'u',
      'ul',
      'wbr'
    ],
    ALLOWED_ATTR: [
      'abbr',
      'colspan',
      'dir',
      'lang',
      'rowspan',
      'scope',
      'title'
    ],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_TRUSTED_TYPE: false
  })
}
