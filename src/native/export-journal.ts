import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { TemporaryTracker } from '@shared/recovery-files'

const recordSchema = z.object({
  version: z.literal(1),
  directory: z.string().max(4096).refine(path.isAbsolute),
  dev: z.number().int(),
  ino: z.number().int()
})
const temporaryName = /^\.liferaft-([a-f0-9-]{36})\.tmp$/
const recordName = /^([1-9][0-9]{0,9})-([a-f0-9-]{36})\.json$/

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** Persist the randomly named temporary before opening it. The journal belongs
 * to the app's data folder, so another account cannot predict that filename. */
export class ExportJournal {
  private readonly folder: string

  constructor(dataPath: string) {
    this.folder = path.join(dataPath, 'active-recoveries')
    fs.mkdirSync(this.folder, { recursive: true, mode: 0o700 })
    const directory = fs.lstatSync(this.folder)
    if (
      !directory.isDirectory() ||
      (process.getuid &&
        (directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0))
    ) {
      throw new Error('Liferaft could not secure its local recovery journal.')
    }
  }

  track: TemporaryTracker = (temporary, parent) => {
    const match = temporaryName.exec(path.basename(temporary))
    if (!match) throw new Error('The recovery temporary filename is invalid.')
    const entry = path.join(this.folder, `${process.pid}-${match[1]}.json`)
    fs.writeFileSync(
      entry,
      JSON.stringify({
        version: 1,
        directory: path.dirname(temporary),
        dev: parent.dev,
        ino: parent.ino
      }),
      { flag: 'wx', mode: 0o600 }
    )
    return () => fs.rmSync(entry, { force: true })
  }

  cleanInterrupted(): void {
    for (const name of fs.readdirSync(this.folder)) {
      const match = recordName.exec(name)
      if (!match) continue
      const pid = Number(match[1])
      if (pid > 0x7fffffff || pid === process.pid) continue
      try {
        process.kill(pid, 0)
        continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue
      }
      const entry = path.join(this.folder, name)
      try {
        const stat = fs.lstatSync(entry)
        if (!stat.isFile() || stat.size > 32 * 1024) continue
        const record = recordSchema.parse(
          JSON.parse(fs.readFileSync(entry, 'utf8'))
        )
        const parent = fs.lstatSync(record.directory)
        if (
          !parent.isDirectory() ||
          parent.dev !== record.dev ||
          parent.ino !== record.ino ||
          fs.realpathSync(record.directory) !== record.directory
        )
          continue
        const temporary = path.join(
          record.directory,
          `.liferaft-${match[2]}.tmp`
        )
        try {
          const file = fs.lstatSync(temporary)
          if (
            !file.isFile() ||
            (process.getuid && file.uid !== process.getuid())
          )
            continue
          fs.unlinkSync(temporary)
        } catch (error) {
          if (!missing(error)) throw error
        }
        fs.rmSync(entry, { force: true })
      } catch (error) {
        // Preserve the record when a disk is offline or the ownership cannot be
        // established. Another desktop or agent process may have just cleaned it.
        if (!missing(error))
          console.error(
            'An interrupted recovery temporary could not be checked.'
          )
      }
    }
  }
}
