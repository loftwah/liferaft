import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, type Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type BetterSqlite3 from 'better-sqlite3'

/** The identity recorded when an archive is indexed or a selection is made. */
export interface SourceSnapshot {
  size: number
  mtimeMs: number
  ctimeMs: number
  dev: number
  ino: number
}

export interface SourceReadOptions {
  expectedSource?: SourceSnapshot
  maxBytes?: number
  signal?: AbortSignal
}

export interface ArchiveExportOptions extends SourceReadOptions {
  expectedIndexRevision?: string
  /** Recheck the caller's grants and index revision immediately before publish. */
  validateBeforeCommit?: () => void | Promise<void>
}

export function getArchiveRecoveryIdentity(db: BetterSqlite3.Database): {
  sourceSnapshot: SourceSnapshot
  indexRevision: string
} {
  try {
    const row = db.prepare('SELECT value FROM archive_metadata WHERE key = ?')
    const stored = row.get('source_snapshot') as { value: string } | undefined
    const revision = row.get('index_revision') as { value: string } | undefined
    const parsed: unknown = stored ? JSON.parse(stored.value) : null
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !revision?.value ||
      !['size', 'mtimeMs', 'ctimeMs', 'dev', 'ino'].every(
        (key) =>
          typeof (parsed as Record<string, unknown>)[key] === 'number' &&
          Number.isFinite((parsed as Record<string, number>)[key])
      )
    ) {
      throw new Error('Missing recovery identity')
    }
    return {
      sourceSnapshot: parsed as SourceSnapshot,
      indexRevision: revision.value
    }
  } catch {
    throw new Error(
      'This index needs to be rebuilt. Reimport the original archive before recovery.'
    )
  }
}

export async function captureSourceSnapshot(
  sourcePath: string
): Promise<SourceSnapshot> {
  return snapshot(await fs.promises.stat(sourcePath))
}

export function sameSource(
  left: SourceSnapshot,
  right: SourceSnapshot
): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino
  )
}

/** Read an indexed range from one open, read-only descriptor, never a later path. */
export async function withSourceRange<T>(
  sourcePath: string,
  start: number,
  end: number,
  consume: (source: Readable) => Promise<T>,
  options: SourceReadOptions = {}
): Promise<T> {
  options.signal?.throwIfAborted()
  const source = await fs.promises.open(sourcePath, 'r')
  let stream: Readable | undefined

  try {
    const before = snapshot(await source.stat())
    if (options.expectedSource && !sameSource(before, options.expectedSource)) {
      throw new Error(
        'The original archive has changed. Reindex it before recovery.'
      )
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > before.size
    ) {
      throw new Error(
        'The indexed byte range is invalid. Reindex the archive before recovery.'
      )
    }
    if (options.maxBytes !== undefined && end - start > options.maxBytes) {
      throw new Error('This message exceeds the recovery size limit.')
    }

    stream =
      start === end
        ? Readable.from([])
        : source.createReadStream({
            start,
            end: end - 1,
            autoClose: false,
            emitClose: false
          })
    let bytesRead = 0
    stream.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length
    })
    const result = await consume(stream)
    options.signal?.throwIfAborted()
    const after = snapshot(await source.stat())
    const current = await captureSourceSnapshot(sourcePath)
    if (
      bytesRead !== end - start ||
      !sameSource(before, after) ||
      !sameSource(before, current)
    ) {
      throw new Error(
        'The original archive changed during recovery. Reindex it and try again.'
      )
    }
    return result
  } finally {
    stream?.destroy()
    await source.close()
  }
}

/**
 * Publish a complete file without replacing any existing path (including links).
 * A failed read, changed source, revoked grant or cancellation leaves no partial
 * destination. Temporary files are private and belong to this one operation.
 */
export async function writeArchiveRangeAtomically(
  input: ArchiveExportOptions & {
    sourcePath: string
    offsetStart: number
    offsetEnd: number
    destinationPath: string
    transforms?: Transform[]
  }
): Promise<void> {
  input.signal?.throwIfAborted()
  const directory = await fs.promises.realpath(
    path.dirname(input.destinationPath)
  )
  const parentBefore = await fs.promises.stat(directory)
  const destination = path.join(directory, path.basename(input.destinationPath))
  const temporary = path.join(directory, `.liferaft-${randomUUID()}.tmp`)
  let temporaryCreated = false

  try {
    // Avoid doing an expensive extraction when the chosen file already exists.
    try {
      await fs.promises.lstat(destination)
      throw new Error(
        'A file already exists at the export destination. Choose a new filename.'
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const output = await fs.promises.open(temporary, 'wx', 0o600)
    temporaryCreated = true
    const outputStream = output.createWriteStream({
      autoClose: false,
      emitClose: false
    })
    try {
      await withSourceRange(
        input.sourcePath,
        input.offsetStart,
        input.offsetEnd,
        async (source) => {
          await pipeline([source, ...(input.transforms ?? []), outputStream], {
            signal: input.signal
          })
        },
        input
      )
      await output.sync()
    } finally {
      outputStream.destroy()
      await output.close()
    }

    const parentAfter = await fs.promises.stat(directory)
    if (
      parentBefore.dev !== parentAfter.dev ||
      parentBefore.ino !== parentAfter.ino ||
      (await fs.promises.realpath(path.dirname(input.destinationPath))) !==
        directory
    ) {
      throw new Error(
        'The export folder changed during recovery. Select it again.'
      )
    }
    await input.validateBeforeCommit?.()
    input.signal?.throwIfAborted()
    // link() is an atomic, exclusive publish on the destination filesystem.
    // rename() would silently overwrite a file created by a concurrent export.
    try {
      await fs.promises.link(temporary, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          'A file already exists at the export destination. Choose a new filename.'
        )
      }
      if (
        ['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(
          (error as NodeJS.ErrnoException).code ?? ''
        )
      ) {
        throw new Error(
          'This folder cannot publish a safe, non-overwriting export. Choose another folder on a local disk.'
        )
      }
      throw error
    }
  } finally {
    if (temporaryCreated) await fs.promises.unlink(temporary)
  }
}

function snapshot(stat: fs.Stats): SourceSnapshot {
  if (!stat.isFile())
    throw new Error('The original archive is not a regular file.')
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino
  }
}
