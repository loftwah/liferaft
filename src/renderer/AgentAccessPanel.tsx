import { useRef, useState } from 'react'
import type { AgentAccessStatus, ArchiveSummary } from '@shared/contracts'

export function AgentAccessPanel({ archives }: { archives: ArchiveSummary[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [access, setAccess] = useState<AgentAccessStatus | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<'opencode' | 'codex'>('opencode')
  const ready = archives.filter((archive) => archive.status === 'ready')

  async function open() {
    dialog.current?.showModal()
    setBusy(true)
    setError(null)
    try {
      const status = await window.liferaft.getAgentAccess()
      setAccess(status)
      setSelected(status.archiveIds)
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  async function changeAccess(enable: boolean) {
    setBusy(true)
    setError(null)
    try {
      const status = enable
        ? await window.liferaft.enableAgentAccess(selected)
        : await window.liferaft.revokeAgentAccess()
      setAccess(status)
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  const config = access
    ? client === 'opencode'
      ? JSON.stringify(
          {
            mcp: {
              servers: {
                liferaft: {
                  type: 'local',
                  command: [access.command, ...access.args]
                }
              }
            }
          },
          null,
          2
        )
      : `[mcp_servers.liferaft]\ncommand = ${JSON.stringify(access.command)}\nargs = ${JSON.stringify(access.args)}\n`
    : ''

  return (
    <>
      <button
        className="secondary-button"
        type="button"
        onClick={() => void open()}
      >
        Agent access
      </button>
      <dialog
        ref={dialog}
        className="agent-dialog"
        aria-labelledby="agent-access-title"
        aria-describedby="agent-access-description"
      >
        <div className="panel-section-header">
          <h2 id="agent-access-title">Agent access</h2>
          <button
            className="secondary-button"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <p id="agent-access-description">
          Let your chosen agent search these archives and recover selected files
          to a folder you choose.
        </p>
        <p className="agent-sharing-note">
          The connection runs on this computer. Your agent may send returned
          messages and snippets to its model provider. Only enable access for
          archives you are comfortable sharing that way.
        </p>
        {error ? (
          <p role="alert" className="error-banner">
            {error}
          </p>
        ) : null}
        <fieldset disabled={busy} className="agent-archives">
          <legend>Archives the agent may read</legend>
          {ready.length === 0 ? (
            <p>Import an archive first. Agent access is optional.</p>
          ) : (
            ready.map((archive) => (
              <label key={archive.id} className="agent-archive-choice">
                <input
                  type="checkbox"
                  checked={selected.includes(archive.id)}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, archive.id]
                        : ids.filter((id) => id !== archive.id)
                    )
                  }
                />
                <span>{archive.name}</span>
              </label>
            ))
          )}
        </fieldset>
        <div className="panel-actions">
          <button
            className="primary-button"
            type="button"
            disabled={busy || selected.length === 0 || selected.length > 32}
            onClick={() => void changeAccess(true)}
          >
            {access?.enabled
              ? 'Change access and folder'
              : 'Choose folder and enable'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !access?.enabled}
            onClick={() => void changeAccess(false)}
          >
            Revoke access
          </button>
        </div>
        <p role="status" aria-live="polite">
          {busy
            ? 'Updating access.'
            : access?.enabled
              ? `Access enabled for ${access.archiveIds.length} archive${access.archiveIds.length === 1 ? '' : 's'}.`
              : 'Access is off. Desktop recovery works without an agent.'}
        </p>
        {access?.enabled ? (
          <>
            <p>
              Approved export folder:{' '}
              <span className="agent-path">
                {access.exportDirectories
                  .map((directory) => directory.path)
                  .join(', ')}
              </span>
            </p>
            <details className="agent-connection">
              <summary>Connect your local agent</summary>
              <p>
                Add these settings to your agent, then reconnect it. The agent
                must run on this computer.
              </p>
              <label htmlFor="agent-client">Agent</label>
              <select
                id="agent-client"
                value={client}
                onChange={(event) =>
                  setClient(event.target.value as 'opencode' | 'codex')
                }
              >
                <option value="opencode">OpenCode</option>
                <option value="codex">Codex</option>
              </select>
              <label htmlFor="agent-config">
                {client === 'opencode'
                  ? 'Merge into opencode.json'
                  : 'Add to Codex config.toml'}
              </label>
              <textarea
                id="agent-config"
                readOnly
                value={config}
                rows={10}
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <p>
                Ask it to find a message, show its source, and recover the
                attachment you choose. Revoke access here to stop future reads
                and exports.
              </p>
            </details>
          </>
        ) : null}
      </dialog>
    </>
  )
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Access could not be updated. Try again.'
}
