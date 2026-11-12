#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 is required. Install it, then run 'bun install --frozen-lockfile'." >&2
  exit 1
fi

if [[ ! -f node_modules/electron/install.js ]]; then
  echo "Install the pinned dependencies first: bun install --frozen-lockfile --ignore-scripts" >&2
  exit 1
fi

node - <<'NODE'
if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error(`Node.js 24 is required; found ${process.versions.node}.`)
  process.exit(1)
}
console.log(`Preparing Electron for ${process.platform}-${process.arch}`)
NODE

# Electron's installer selects the host platform, verifies the download and
# manages its cache. Use the locked local package; do not download an unpinned
# rebuild tool or delete an existing runtime before a replacement is available.
node node_modules/electron/install.js

# better-sqlite3 13 uses Node-API prebuilds shared by Node and Electron. This
# verifies the host binding; installed Electron acceptance remains a separate check.
node - <<'NODE'
const Database = require('better-sqlite3')
const database = new Database(':memory:')
const version = database.prepare('select sqlite_version() as version').get().version
database.close()
console.log(`Electron runtime prepared; host SQLite ${version} loaded.`)
NODE
