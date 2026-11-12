import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  fictionalInvoiceMbox,
  fictionalInvoicePdf
} from '../tests/fixtures/invoice'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-fictional-'))
const archive = path.join(directory, 'fictional-invoice.mbox')
const expected = path.join(directory, 'expected-invoice.pdf')
fs.writeFileSync(archive, fictionalInvoiceMbox(), { flag: 'wx', mode: 0o600 })
fs.writeFileSync(expected, fictionalInvoicePdf(), { flag: 'wx', mode: 0o600 })
fs.mkdirSync(path.join(directory, 'recovered'))
console.log(`Import this fictional archive: ${archive}`)
console.log(`Choose this export folder: ${path.join(directory, 'recovered')}`)
console.log(`Expected PDF: ${expected}`)
console.log(
  `Expected PDF SHA-256: ${createHash('sha256').update(fictionalInvoicePdf()).digest('hex')}`
)
console.log(
  'After checking the app, remove its local index and this temporary fixture folder.'
)
