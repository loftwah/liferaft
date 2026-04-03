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

To create local installer artifacts:

```bash
bun run dist
```

Packaged builds will be written to `release/`.

## Test

```bash
bun run format
bun run format:check
bun test
bun run typecheck
```

## GitHub releases

This repository is configured to publish downloadable desktop builds through GitHub Releases.

Tag format:

- Release tags must start with `v` and use semantic versioning: `vMAJOR.MINOR.PATCH`
- Examples: `v0.1.0`, `v0.2.3`, `v1.0.0`
- The GitHub Actions release workflow only triggers for tags matching `v*`

Release flow:

1. Update `package.json` to the version you want to ship.
2. Commit the release changes.
3. Trigger the release in one of two ways: push a matching git tag such as `v0.2.0`, or run the `Release` workflow manually from the GitHub Actions tab and enter the tag you want created.
4. GitHub Actions will build macOS, Windows, and Linux packages and attach them to the GitHub release for that tag.

Example:

```bash
git tag v0.2.0
git push origin main --follow-tags
```

Notes:

- The workflow publishes unsigned builds. macOS Gatekeeper and Windows SmartScreen may warn until code signing is added.
- Release artifacts are produced with `electron-builder` and uploaded from `.github/workflows/release.yml`.
- Manual runs of the `Release` workflow create the requested `v*` tag on the selected branch or commit, then the normal tag-based release build runs automatically.

## Opening unsigned builds

The current GitHub Release artifacts are unsigned. That is normal for an early-stage desktop utility, but users may need to confirm the first launch manually.

macOS:

- macOS may block the app on first launch because the build is not notarized.
- If Finder says Liferaft cannot be opened, right-click the app and choose `Open`.
- If macOS still blocks it, open `System Settings` > `Privacy & Security` and allow the app to run.
- If Gatekeeper still rejects the app after you move it to `/Applications`, remove the quarantine flag and open it again:

```bash
xattr -dr com.apple.quarantine "/Applications/Liferaft.app"
```

Windows:

- If SmartScreen warns before launch, click `More info` and then `Run anyway`.

Linux:

- Linux builds typically do not require an additional trust step beyond making the download executable when needed.

Code signing is worth adding later if Liferaft is distributed broadly or non-technical users are expected to install it often. For now, most developers would ship unsigned builds and document the warning clearly.

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
