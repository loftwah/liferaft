# Liferaft

![Liferaft overview](./og-image.jpg)

Liferaft is a local, read-only Electron desktop app for opening large `.mbox` archives, indexing them locally, searching them quickly, previewing messages in a familiar three-pane layout, and exporting attachments or selected messages for recovery work.

It is intentionally not an email client. There is no account login, sync, compose, send, reply, or remote access path.

## What it does

- Imports one or more `.mbox` archives into per-archive SQLite databases
- Streams the source file during import inside an Electron utility process
- Indexes message metadata and body text with SQLite FTS5
- Stores message byte ranges and attachment MIME-part offsets for targeted export
- Searches subject, attachment names, sender, recipients, and body with ranking
- Shows a three-pane recovery-oriented UI with progress, filters, result list, and preview
- Exports:
  - a single attachment
  - all attachments from a message
  - a message as `.eml`

## Tech stack

- Electron 41
- React 19 + TypeScript
- Vite + electron-vite
- Tailwind CSS v4 + `@tailwindcss/vite`
- SQLite FTS5
- `better-sqlite3`
- `mailparser`
- `react-virtuoso`
- `zustand`

## Run locally

This repository uses Bun for scripts, but native modules and the Electron binary are most reliable from a Node toolchain. In this environment, the easiest path is:

```bash
bun install --ignore-scripts
nix-shell -p nodejs python3 pkg-config --run './scripts/bootstrap-electron-runtime.sh'
bun run dev
```

To launch the compiled app directly:

```bash
bun run build
bun run start
```

Or do both in one command:

```bash
bun run start:built
```

## Test

```bash
bun run format
bun run format:check
bun test
bun run typecheck
```

## Architecture

- `src/main`
  - window creation
  - catalog DB
  - archive search, preview, export, and strict IPC
- `src/utility`
  - streamed MBOX splitting
  - message parsing
  - attachment offset extraction
  - archive indexing
- `src/preload`
  - narrow renderer bridge
- `src/renderer`
  - read-only UI only

## Notes and tradeoffs

- The archive importer streams the full mbox file and never loads the full archive into memory.
- Message parsing currently buffers one message at a time inside the utility process. That keeps archive-scale memory bounded, but a single extremely large message can still be expensive.
- Attachment export uses stored MIME-part body offsets and transfer-encoding metadata, so it does not need to reparse the full message.
- Message preview reparses the selected message on demand to avoid duplicating full message bodies in SQLite.
- HTML preview is sanitized in the renderer and external requests are blocked by CSP.
