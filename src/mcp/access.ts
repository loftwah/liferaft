import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_CONFIG_BYTES = 64 * 1024

export interface AgentExportDirectory {
  id: string
  name: string
  path: string
  dev: number
  ino: number
}

export interface AgentAccessConfig {
  version: 1
  revision: string
  enabled: true
  acknowledgeCloudSharing: true
  archiveIds: string[]
  exportDirectories: AgentExportDirectory[]
}

export interface AgentGrantInput {
  archiveIds: string[]
  exportDirectories: string[]
  acknowledgeCloudSharing: boolean
}

/** Only the desktop/owner writes this file. No MCP tool can change grants. */
export class AgentAccessStore {
  readonly filePath: string

  constructor(private readonly dataPath: string) {
    this.filePath = path.join(dataPath, 'agent-access.json')
  }

  read(): AgentAccessConfig | null {
    let fd: number | undefined
    try {
      const before = fs.lstatSync(this.filePath)
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size > MAX_CONFIG_BYTES
      ) {
        throw new Error(
          'Agent access settings are invalid. Review them in Liferaft.'
        )
      }
      fd = fs.openSync(
        this.filePath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
      )
      const actual = fs.fstatSync(fd)
      if (
        !actual.isFile() ||
        actual.dev !== before.dev ||
        actual.ino !== before.ino ||
        actual.size > MAX_CONFIG_BYTES
      ) {
        throw new Error(
          'Agent access settings changed. Review them in Liferaft.'
        )
      }
      // Bound the read itself as well as the initial stat; an owner editing the
      // file in place must not turn this into an unbounded allocation.
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1)
      let bytes = 0
      while (bytes < buffer.length) {
        const read = fs.readSync(
          fd,
          buffer,
          bytes,
          buffer.length - bytes,
          bytes
        )
        if (read === 0) break
        bytes += read
      }
      if (bytes > MAX_CONFIG_BYTES) {
        throw new Error('Agent access settings are too large.')
      }
      const after = fs.fstatSync(fd)
      if (
        actual.size !== after.size ||
        actual.mtimeMs !== after.mtimeMs ||
        actual.ctimeMs !== after.ctimeMs
      ) {
        throw new Error('Agent access settings changed while being read.')
      }
      const value: unknown = JSON.parse(
        buffer.subarray(0, bytes).toString('utf8')
      )
      if (isRecord(value) && value.version === 1 && value.enabled === false) {
        return null
      }
      if (!isAccessConfig(value)) {
        throw new Error(
          'Agent access settings are invalid. Review them in Liferaft.'
        )
      }
      return value
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw new Error(
        'Agent access settings cannot be read. Review them in Liferaft.'
      )
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  grant(input: AgentGrantInput): AgentAccessConfig {
    if (
      input.acknowledgeCloudSharing !== true ||
      !Array.isArray(input.archiveIds) ||
      input.archiveIds.length < 1 ||
      input.archiveIds.length > 32 ||
      input.archiveIds.some((id) => !validId(id)) ||
      !Array.isArray(input.exportDirectories) ||
      input.exportDirectories.length > 8
    ) {
      throw new Error(
        'Choose archives and confirm how your agent handles shared content.'
      )
    }

    const directories = [
      ...new Set(
        input.exportDirectories.map((directory) => {
          if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
            throw new Error('Choose an existing export folder in Liferaft.')
          }
          return fs.realpathSync(directory)
        })
      )
    ]

    const config: AgentAccessConfig = {
      version: 1,
      revision: randomUUID(),
      enabled: true,
      acknowledgeCloudSharing: true,
      archiveIds: [...new Set(input.archiveIds)],
      exportDirectories: directories.map((directory) => {
        const stat = fs.statSync(directory)
        if (!stat.isDirectory()) {
          throw new Error('Choose an existing export folder in Liferaft.')
        }
        return {
          id: randomUUID(),
          name: path.basename(directory) || directory,
          path: directory,
          dev: stat.dev,
          ino: stat.ino
        }
      })
    }
    this.write(config)
    return config
  }

  revoke(): void {
    this.write({ version: 1, enabled: false, revision: randomUUID() })
  }

  private write(value: unknown): void {
    fs.mkdirSync(this.dataPath, { recursive: true })
    const temporary = path.join(
      this.dataPath,
      `.agent-access-${randomUUID()}.tmp`
    )
    let fd: number | undefined
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(temporary, this.filePath)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      fs.rmSync(temporary, { force: true })
    }
  }
}

export function verifyExportDirectory(directory: AgentExportDirectory): string {
  try {
    const resolved = fs.realpathSync(directory.path)
    const stat = fs.statSync(resolved)
    if (
      resolved !== directory.path ||
      !stat.isDirectory() ||
      stat.dev !== directory.dev ||
      stat.ino !== directory.ino
    ) {
      throw new Error('changed')
    }
    return resolved
  } catch {
    throw new Error(
      'The approved export folder changed or is unavailable. Choose it again in Liferaft.'
    )
  }
}

function isAccessConfig(value: unknown): value is AgentAccessConfig {
  return (
    isRecord(value) &&
    value.version === 1 &&
    value.enabled === true &&
    value.acknowledgeCloudSharing === true &&
    validId(value.revision) &&
    Array.isArray(value.archiveIds) &&
    value.archiveIds.length > 0 &&
    value.archiveIds.length <= 32 &&
    value.archiveIds.every(validId) &&
    new Set(value.archiveIds).size === value.archiveIds.length &&
    Array.isArray(value.exportDirectories) &&
    value.exportDirectories.length <= 8 &&
    value.exportDirectories.every(
      (directory: unknown) =>
        isRecord(directory) &&
        validId(directory.id) &&
        typeof directory.name === 'string' &&
        directory.name.length <= 4096 &&
        typeof directory.path === 'string' &&
        directory.path.length <= 4096 &&
        path.isAbsolute(directory.path) &&
        typeof directory.dev === 'number' &&
        Number.isSafeInteger(directory.dev) &&
        typeof directory.ino === 'number' &&
        Number.isSafeInteger(directory.ino)
    )
  )
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
