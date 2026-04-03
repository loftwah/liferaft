#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_PKG_JSON="$ROOT_DIR/node_modules/electron/package.json"
ELECTRON_DIR="$ROOT_DIR/node_modules/electron"
DIST_DIR="$ELECTRON_DIR/dist"
PATH_FILE="$ELECTRON_DIR/path.txt"

if [[ ! -f "$ELECTRON_PKG_JSON" ]]; then
  echo "electron is not installed yet. Run 'bun install --ignore-scripts' first." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. In this repo, use: nix-shell -p nodejs python3 pkg-config --run './scripts/bootstrap-electron-runtime.sh'" >&2
  exit 1
fi

ELECTRON_VERSION="$(node -p "require('$ELECTRON_PKG_JSON').version")"
ARCH="$(uname -m)"
PLATFORM="darwin"

case "$ARCH" in
  arm64|aarch64)
    ELECTRON_ARCH="arm64"
    ;;
  x86_64)
    ELECTRON_ARCH="x64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ZIP_NAME="electron-v${ELECTRON_VERSION}-${PLATFORM}-${ELECTRON_ARCH}.zip"
DOWNLOAD_URL="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${ZIP_NAME}"
TMP_ZIP="${TMPDIR:-/tmp}/${ZIP_NAME}"

echo "Downloading Electron ${ELECTRON_VERSION} for ${PLATFORM}-${ELECTRON_ARCH}"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
curl -L "$DOWNLOAD_URL" -o "$TMP_ZIP"
unzip -q -o "$TMP_ZIP" -d "$DIST_DIR"
printf 'Electron.app/Contents/MacOS/Electron' > "$PATH_FILE"

echo "Rebuilding better-sqlite3 for Electron"
npx electron-rebuild -f -w better-sqlite3

echo "Electron runtime bootstrapped."
