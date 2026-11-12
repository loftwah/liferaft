# Liferaft

![Liferaft overview](./og-image.jpg)

Liferaft helps you find messages and recover attachments from large `.mbox`
archives. It indexes mail locally, searches it with SQLite FTS5, and shows the
selected message in a three-pane desktop interface. Recovery creates a copy;
the original archive stays read-only.

**Current source version: 0.2.0.** These source changes have not published a new
installer. [Published downloads](https://github.com/loftwah/liferaft/releases)
retain their own release versions. See the [verification ledger](docs/verification.md)
for what this update actually checked and the remaining desktop acceptance work.

## What it does

- Import one or more archives and index them in a background utility process.
- Search subjects, senders, recipients, message text and attachment names.
- Filter results and inspect the source message before recovering a file.
- Export one attachment, all attachments from a message, or a selected `.eml`.
- Optionally let a local MCP agent recover files from explicitly selected archives
  into an approved folder.

Desktop indexing and recovery need no account, API key or hosted service.
**Optional agent access has a separate sharing boundary:** your chosen agent may
send requested message details to its model provider. Read the notice in
**Agent access** before enabling it. See [agent recovery](docs/AGENT_RECOVERY.md).

## Run from source

Use **Node.js 24.15 or newer within Node 24**, and **Bun 1.4.4**. This update was
checked with Node 24.22.1. Install those tools using their official instructions,
then run these commands from the repository:

```sh
bun install --frozen-lockfile
bun run check
bun run dev
```

The install step uses the pinned Electron installer, which selects the correct
host platform and architecture. The lockfile fixes dependency resolution.

To build and open the compiled app:

```sh
bun run start:built
```

To open an existing build without rebuilding it:

```sh
bun run start
```

For source checks without downloading Electron immediately:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run build
# Download the desktop runtime when ready to use it:
bun run setup:desktop
```

The portable [Bash bootstrap](scripts/bootstrap-electron-runtime.sh) is an
alternative to `setup:desktop` and also checks the host SQLite binding. No Nix
shell or unpinned rebuild download is required. Exact versions and native
packaging decisions are in [toolchain.md](docs/toolchain.md).

## Check a fictional recovery

Create a temporary archive containing one fictional invoice and a valid PDF:

```sh
bun run scripts/create-recovery-fixture.ts
bun run start:built
```

The command prints the MBOX path, an empty recovery folder, the expected PDF and
its SHA-256 digest. Import that archive, wait for indexing, search for
`Alice invoice`, inspect the message, and export `invoice.pdf` into the printed
folder. Open the recovered PDF and compare its digest with the expected value.
The fixture contains no private mail and does not overwrite existing files.

For the optional agent journey, select only that archive and folder in **Agent
access**, acknowledge the sharing notice, and use the configuration shown there
in your local client. Ask it to find Alice's invoice, show its source and recover
its PDF. Revoke access afterwards and confirm that further calls are denied.
The [acceptance steps](docs/verification.md#local-acceptance-steps) cover
cancellation, stale selections and removing the temporary index safely.

### Existing archives need one reindex

Indexes created by older versions lack the source-file identity and index
revision now used to prevent stale selections from recovering the wrong item.
Use **Reindex** once for each existing archive and wait for it to finish before
previewing or exporting. Reindexing rebuilds Liferaft's replaceable local index;
it leaves the original MBOX in place. Select the result again after a reindex.

## Tests and local packages

```sh
bun run test
bun run test:integration
bun run typecheck
bun run format:check
bun run build
```

`bun run check` runs formatting, both test suites and type checking. The Node
integration suite uses the actual native SQLite dependency; Bun's unit suite is
not the only database check. Current verification results and their limits are
recorded in [verification.md](docs/verification.md) and the associated PR.

To create local installer artefacts for the host platform:

```sh
bun run dist
```

This builds and packages with publication disabled. Output goes to `release/`.
macOS builds require macOS 13 or later. Check the actual installed package on
each intended OS and architecture; a successful build does not establish native
dialogs, keyboard access, screen-reader use or the complete recovery journey.

The package allowlist includes the built application, its manifest, licence and
production dependencies. Personal archives, recovered exports, test fixtures,
agent configuration and development tools stay outside the package.

## Release status

The existing [release workflow](.github/workflows/release.yml) handles `v*` tag
pushes and manual dispatch. Its Node and Bun pins match this source update, but
it was not run as part of this work. Branch or PR activity is not release proof.

Establish installed desktop acceptance before publishing. Release tags, workflow
dispatch and `bun run release` publish artefacts; `bun run dist` is the local
packaging path. Follow the owner's established release authority.
Signing and notarisation remain release concerns. Preserve operating-system
security checks; the old quarantine-clearing install script is not part of the
recommended setup.

## Architecture and working notes

| Location       | Responsibility                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| `src/main`     | Desktop lifecycle, catalogue, search, preview, export and validated IPC.       |
| `src/utility`  | Streamed import, MIME parsing, attachment offsets and indexing.                |
| `src/preload`  | Narrow, typed bridge between the renderer and main process.                    |
| `src/renderer` | Recovery interface, passive email preview and explicit agent permissions.      |
| `src/mcp`      | Optional local stdio server, archive/folder grants and bounded recovery tools. |
| `src/shared`   | Contracts, schema, search and MIME helpers shared by those paths.              |

The toolchain is Electron 45, React 19, TypeScript 7, Vite 8, Tailwind 4 and
SQLite FTS5 through `better-sqlite3` 13. The importer streams archives but still
buffers an individual message and rejects individual messages over 64 MiB.
Preview reads are bounded. Exports use recorded byte ranges and transfer
encoding, validate source/index identity, and publish without overwriting an
existing file. Passive HTML preview strips active content and external requests
remain blocked.

[Rune was assessed](docs/rune-assessment.md). It is a Rust GPU UI framework with
an experimental WASM/WebGPU target, not a drop-in React library. No Rune runtime
or renderer is included in this update; the assessment records the compatibility
boundary and the smallest useful follow-up experiment.

For changes, start with [AGENTS.md](AGENTS.md), then read the relevant
[recovery contract](docs/AGENT_RECOVERY.md), [copy guidance](docs/VOICE.md) or
[toolchain notes](docs/toolchain.md).
