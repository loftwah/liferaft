import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  captureSourceSnapshot,
  writeArchiveRangeAtomically
} from '../src/shared/recovery-files'
import { decoderForTransferEncoding } from '../src/shared/transfer-decoder'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})

function fixture(content = 'original archive contents') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-recovery-'))
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  const sourcePath = path.join(directory, 'archive.mbox')
  fs.writeFileSync(sourcePath, content)
  return {
    directory,
    sourcePath,
    destinationPath: path.join(directory, 'recovered.eml'),
    offsetStart: 0,
    offsetEnd: Buffer.byteLength(content)
  }
}

function expectNoTemporaryFiles(directory: string) {
  expect(
    fs.readdirSync(directory).filter((name) => name.startsWith('.liferaft-'))
  ).toEqual([])
}

describe('atomic recovery writes', () => {
  test('never overwrites the source archive, an existing file, or a symlink target', async () => {
    const input = fixture()
    const original = fs.readFileSync(input.sourcePath)
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        destinationPath: input.sourcePath
      })
    ).rejects.toThrow('already exists')
    fs.writeFileSync(input.destinationPath, 'existing document')
    await expect(writeArchiveRangeAtomically(input)).rejects.toThrow(
      'already exists'
    )
    const link = path.join(input.directory, 'link.eml')
    fs.symlinkSync(input.sourcePath, link)
    await expect(
      writeArchiveRangeAtomically({ ...input, destinationPath: link })
    ).rejects.toThrow('already exists')
    expect(fs.readFileSync(input.sourcePath)).toEqual(original)
    expect(fs.readFileSync(input.destinationPath, 'utf8')).toBe(
      'existing document'
    )
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expectNoTemporaryFiles(input.directory)
  })

  test('two concurrent exports cannot replace each other', async () => {
    const input = fixture()
    const outcomes = await Promise.allSettled([
      writeArchiveRangeAtomically(input),
      writeArchiveRangeAtomically(input)
    ])
    expect(
      outcomes.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      outcomes.filter((result) => result.status === 'rejected')
    ).toHaveLength(1)
    expect(fs.readFileSync(input.destinationPath)).toEqual(
      fs.readFileSync(input.sourcePath)
    )
    expectNoTemporaryFiles(input.directory)
  })

  test('retains the journal when the destination folder changes before publish', async () => {
    const input = fixture()
    const folder = path.join(input.directory, 'output')
    const moved = path.join(input.directory, 'original-folder')
    const destinationPath = path.join(folder, 'recovered.eml')
    fs.mkdirSync(folder)
    let temporaryName = ''
    let cleared = false
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        destinationPath,
        trackTemporary: (temporary) => {
          temporaryName = path.basename(temporary)
          return () => {
            cleared = true
          }
        },
        validateBeforeCommit: () => {
          fs.renameSync(folder, moved)
          fs.mkdirSync(folder)
          fs.writeFileSync(path.join(folder, temporaryName), 'unrelated file')
        }
      })
    ).rejects.toThrow('export folder changed')
    expect(fs.existsSync(destinationPath)).toBe(false)
    expect(fs.readFileSync(path.join(folder, temporaryName), 'utf8')).toBe(
      'unrelated file'
    )
    expect(fs.existsSync(path.join(moved, temporaryName))).toBe(true)
    expect(cleared).toBe(false)
  })

  test('reports a successful export even if its cleanup record cannot be removed', async () => {
    const input = fixture()
    await writeArchiveRangeAtomically({
      ...input,
      trackTemporary: () => () => {
        throw new Error('journal cleanup failed')
      }
    })
    expect(fs.readFileSync(input.destinationPath)).toEqual(
      fs.readFileSync(input.sourcePath)
    )
    expectNoTemporaryFiles(input.directory)
  })

  test('missing sources and invalid ranges leave no output', async () => {
    const input = fixture()
    for (const offsets of [
      { offsetStart: -1, offsetEnd: 1 },
      { offsetStart: 2, offsetEnd: 1 },
      { offsetStart: 0, offsetEnd: input.offsetEnd + 1 }
    ]) {
      await expect(
        writeArchiveRangeAtomically({ ...input, ...offsets })
      ).rejects.toThrow('byte range')
      expect(fs.existsSync(input.destinationPath)).toBe(false)
    }
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        sourcePath: path.join(input.directory, 'missing.mbox')
      })
    ).rejects.toThrow()
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })

  test('changed sources are rejected both before and during extraction', async () => {
    const input = fixture()
    const expectedSource = await captureSourceSnapshot(input.sourcePath)
    fs.utimesSync(input.sourcePath, new Date(1_000), new Date(1_000))
    await expect(
      writeArchiveRangeAtomically({ ...input, expectedSource })
    ).rejects.toThrow('archive has changed')
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        transforms: [
          new Transform({
            transform(chunk, _encoding, callback) {
              fs.truncateSync(input.sourcePath, 1)
              callback(null, chunk)
            }
          })
        ]
      })
    ).rejects.toThrow('changed during recovery')
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })

  test('failed decoding, cancellation, and revoked grants discard partial output', async () => {
    const input = fixture('UERG')
    const failure = new Transform({
      transform(_chunk, _encoding, callback) {
        callback(new Error('decoder failure'))
      }
    })
    await expect(
      writeArchiveRangeAtomically({ ...input, transforms: [failure] })
    ).rejects.toThrow('decoder failure')
    const controller = new AbortController()
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        signal: controller.signal,
        validateBeforeCommit: () => controller.abort()
      })
    ).rejects.toThrow()
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        validateBeforeCommit: () => {
          throw new Error('grant revoked')
        }
      })
    ).rejects.toThrow('grant revoked')
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })

  test('zero-length attachments remain empty and extraction respects bounds', async () => {
    const input = fixture()
    await expect(
      writeArchiveRangeAtomically({ ...input, maxBytes: 1 })
    ).rejects.toThrow('size limit')
    await writeArchiveRangeAtomically({
      ...input,
      offsetStart: 5,
      offsetEnd: 5
    })
    expect(fs.statSync(input.destinationPath).size).toBe(0)
    expectNoTemporaryFiles(input.directory)
  })
})

async function decode(encoding: string, chunks: Buffer[]) {
  const output: Buffer[] = []
  await pipeline(
    Readable.from(chunks),
    decoderForTransferEncoding(encoding),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output.push(chunk)
        callback()
      }
    })
  )
  return Buffer.concat(output)
}

describe('attachment transfer decoding', () => {
  test('quoted-printable preserves raw binary bytes and split escape sequences', async () => {
    const encoded = Buffer.concat([
      Buffer.from('=00=FF=\r\nA=3D=\n'),
      Buffer.from([0xc3, 0xa9, 0xff]),
      Buffer.from('=broken=')
    ])
    const expected = Buffer.concat([
      Buffer.from([0, 255, 65, 61, 0xc3, 0xa9, 0xff]),
      Buffer.from('=broken=')
    ])
    expect(
      await decode(
        'quoted-printable',
        Array.from(encoded, (byte) => Buffer.from([byte]))
      )
    ).toEqual(expected)
  })

  test('base64 decodes split blocks and rejects damaged content', async () => {
    expect(
      (
        await decode('base64', [Buffer.from('U'), Buffer.from('ER\r\nG')])
      ).toString()
    ).toBe('PDF')
    expect(
      (
        await decode('base64', [
          Buffer.from('aG'),
          Buffer.from('k='),
          Buffer.from('\r\n')
        ])
      ).toString()
    ).toBe('hi')
    for (const encoded of ['!', 'A', 'UE==AAAA', 'U=RG', 'UE=']) {
      await expect(decode('base64', [Buffer.from(encoded)])).rejects.toThrow(
        'base64'
      )
    }
  })
})
