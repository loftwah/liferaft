# Toolchain and native runtime

Dependency review: 2026/11/12 Australia/Melbourne (AEDT, UTC+11);
2026/11/12 UTC.

## Supported development setup

Use Node.js 24.15 or newer within Node 24 and Bun 1.4.4. The verified host is
Node 24.22.1. `packageManager` records the Bun version, direct
dependencies are exact versions, and `bun.lock` records transitive resolution.

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun run dev
```

Installation downloads the pinned Electron runtime through Electron's own
installer. For source checks without downloading Electron immediately:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test
bun run test:integration
bun run typecheck
bun run build
# When ready to run the desktop app:
bun run setup:desktop
```

`scripts/bootstrap-electron-runtime.sh` remains available for Bash users. It
invokes the same local installer and verifies the host SQLite binding. It does
not assume macOS, download an unpinned rebuild tool, or delete the runtime first.

## Upgrade decisions

| Component            | Pinned version | Relevant change                                                                    |
| -------------------- | -------------- | ---------------------------------------------------------------------------------- |
| Electron             | 45.3.1         | Current runtime; sandboxed preload uses only Electron's supported bridge API.      |
| Electron Vite        | 6.0.0          | Replaces deprecated `externalizeDepsPlugin` with build configuration.              |
| Vite / React plugin  | 8.3.8 / 6.3.0  | Uses `rolldownOptions`; native SQLite stays external.                              |
| TypeScript           | 7.0.2          | Removes obsolete `baseUrl`; explicit relative aliases and Vite client asset types. |
| React / React DOM    | 19.3.1         | Matched renderer versions.                                                         |
| Tailwind Vite plugin | 4.3.5          | Compatible with Vite 8.                                                            |
| better-sqlite3       | 13.1.1         | Node-API native prebuilds replace Electron-version-specific bindings.              |
| MCP server / Zod     | 2.4.0 / 4.6.7  | Pinned optional agent protocol and input validation dependencies.                  |
| tsx                  | 4.23.15        | Runs integration tests with Node and the actual native SQLite package.             |

Other direct runtime and development dependencies were refreshed to registry
versions recorded in the manifest and lockfile. Unused direct dependencies
`@radix-ui/react-progress`, `electron-log` and `semver` were removed after a
repository usage search. `mime-types` remains because filename recovery uses it.

The preload remains a CommonJS bundle with `electron`/`electron/renderer` external
and other dependencies bundled. This preserves the sandboxed preload model;
the Electron upgrade does not require enabling Node integration or weakening
renderer security settings.

## Why native rebuilding is disabled

`better-sqlite3` 13 ships Node-API prebuilds within its package. The same Linux x64
binding was loaded successfully by host Node 24.22.1 and Electron 45.3.1's embedded
Node 24.22.2, including FTS5 table creation, insertion and searching; both reported
SQLite 3.54.1.

Electron Builder's generic rebuild path failed to identify Electron 45.3.1 in
its `node-abi` table. That ABI-specific rebuild is unnecessary for this Node-API
dependency. `build.npmRebuild` is therefore `false`, and the packaged native
`.node` files are explicitly unpacked from ASAR. Reassess this choice if another
native dependency is added or the SQLite package changes its binary format.
Do not solve a future native failure by silently substituting a different database
implementation in production.

Electron 42 and later no longer download their runtime through their own
`postinstall`; the project's `postinstall` and `setup:desktop` explicitly run
the locked `install-electron` command. This preserves an ordinary fresh checkout
workflow without an implicit `npx` download.

## Tests and packaging boundaries

`bun run test` runs the top-level unit tests. `bun run test:integration` runs
Node's test runner through `tsx`, including native SQLite and the stdio protocol.
The separate command prevents Bun's SQLite compatibility layer from being the
only database evidence. `bun run check` includes both suites and type checking.
Final counts and the source commit are recorded in the associated PR; see the
[verification ledger](verification.md) for the scope and remaining checks.

The existing release workflow pins Node 24.22.1 and Bun 1.4.4. Its triggers were
not changed and it was not executed for this update. Local verification does
not establish that the remote release workflow or every installer target passes.

Packaging uses a positive file allowlist: built `out/**`, `package.json` and
`LICENSE`, plus Electron Builder's production dependency handling. Source
archives, recovered exports, tests, agent configuration, documentation and local
tooling do not enter the app merely because a new file was added to the checkout.

Electron 44+ requires macOS 13 or later and supports 64-bit release targets. The
macOS packaging minimum is recorded explicitly. Check each supported installer
on its actual OS/architecture with fictional import, search, preview and export
data. A build or embedded-Node native probe is not installed desktop acceptance.

A local Linux x64 directory package was also built with publication disabled.
Its ASAR root contained only `node_modules`, `LICENSE`, `out` and `package.json`;
the SQLite prebuilds were unpacked correctly. The packaged executable loaded
SQLite from its own `app.asar` in embedded-Node mode and passed the same FTS5
probe. This verifies package inclusion and native loading, not GUI behaviour or
an installed macOS/Windows release.

## Upstream references

- [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
- [Electron Vite 6 changelog](https://github.com/alex8088/electron-vite/blob/v6.0.0/CHANGELOG.md)
- [Electron Vite dependency handling](https://electron-vite.org/guide/dependency-handling)
- [Vite 8 migration](https://vite.dev/guide/migration)
- [TypeScript configuration: paths and baseUrl](https://www.typescriptlang.org/docs/handbook/modules/reference.html#baseurl)
- [better-sqlite3 13 release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
- [better-sqlite3 13.1.1 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.1.1)
- [Electron Builder configuration](https://www.electron.build/configuration/)
