import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'

const documentWindow = new JSDOM('<!doctype html><html><body></body></html>')
  .window
Object.defineProperty(globalThis, 'window', {
  value: documentWindow,
  configurable: true
})
const { sanitiseMessageHtml } = await import('../../src/renderer/message-html')
after(() => {
  Reflect.deleteProperty(globalThis, 'window')
  documentWindow.close()
})

test('formatted mail cannot style the application, navigate, fetch media or create interactive controls', () => {
  const input = [
    '<style>body { display: none }</style>',
    '<div id="agent-access-title" class="agent-dialog" style="position:fixed;inset:0" data-action="grant">',
    '<p onclick="alert(1)">Fictional invoice <strong>123</strong></p>',
    '<form action="https://example.test"><input name="secret"><button>Enable access</button></form>',
    '<a href="file:///fictional/archive.mbox" target="_blank">Reference link</a>',
    '<img src="https://example.test/pixel">',
    '<audio autoplay src="https://example.test/audio"></audio>',
    '<video autoplay><source src="https://example.test/video"></video>',
    '<iframe src="https://example.test"></iframe>',
    '<svg onload="alert(1)"><a href="https://example.test">SVG link</a></svg>',
    '<script>alert(1)</script>',
    '</div>'
  ].join('')
  const result = JSDOM.fragment(sanitiseMessageHtml(input))
  assert.equal(
    result.querySelector(
      'style,script,form,input,button,img,audio,video,source,iframe,svg'
    ),
    null
  )
  for (const element of result.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      assert.ok(
        [
          'abbr',
          'colspan',
          'dir',
          'lang',
          'rowspan',
          'scope',
          'title'
        ].includes(attribute.name),
        attribute.name
      )
    }
  }
  assert.equal(result.querySelector('strong')?.textContent, '123')
  assert.ok(result.textContent?.includes('Reference link'))
  assert.equal(
    result.querySelector('[id],[name],[href],[src],[style],[class]'),
    null
  )
})

test('passive message formatting preserves text, lists and table labels', () => {
  const result = JSDOM.fragment(
    sanitiseMessageHtml(
      '<h2>Invoice</h2><p>Amount <strong>$12.00</strong></p><ul><li>Fictional service</li></ul>' +
        '<table><tr><th scope="col">Item</th><td colspan="2">123</td></tr></table>'
    )
  )
  assert.equal(result.querySelector('h2')?.textContent, 'Invoice')
  assert.equal(result.querySelector('li')?.textContent, 'Fictional service')
  assert.equal(result.querySelector('th')?.getAttribute('scope'), 'col')
  assert.equal(result.querySelector('td')?.getAttribute('colspan'), '2')
})
