import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { observeImportProcess } from '../../src/main/import-lifecycle'

test('owned process stop waits for actual exit before index cleanup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-process-'))
  const index = path.join(directory, 'owned-index')
  fs.writeFileSync(index, 'active')
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import fs from 'node:fs'
    process.on('SIGTERM', () => {
      setTimeout(() => {
        fs.writeFileSync(process.argv[1], 'closed')
        process.exit(0)
      }, 30)
    })
    setInterval(() => {}, 1000)
    process.stdout.write('ready')
  `,
      index
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  child.stderr.resume()
  const lifetime = observeImportProcess(child)
  try {
    await once(child.stdout, 'data')
    await lifetime.stop()
    assert.equal(child.exitCode, 0)
    assert.equal(fs.readFileSync(index, 'utf8'), 'closed')
    fs.rmSync(index)
    await lifetime.stop()
    assert.equal(fs.existsSync(index), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
    await lifetime.exited
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('stop timeout preserves unfinished owned files and permits a later retry', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-process-'))
  const index = path.join(directory, 'owned-index')
  fs.writeFileSync(index, 'unfinished')
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
    process.stdout.write('ready')
  `
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  child.stderr.resume()
  const lifetime = observeImportProcess(child)
  try {
    await once(child.stdout, 'data')
    await assert.rejects(lifetime.stop(40), /has not stopped/)
    assert.equal(child.exitCode, null)
    assert.equal(fs.readFileSync(index, 'utf8'), 'unfinished')
    // This test owns this specific child; force termination is test teardown,
    // never a broad process lookup or the desktop application's behaviour.
    child.kill('SIGKILL')
    await lifetime.exited
    await lifetime.stop(40)
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
    await lifetime.exited
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
