#!/bin/bash

set -euo pipefail

REPO="${LIFERAFT_REPO:-loftwah/liferaft}"
INSTALL_DIR="${LIFERAFT_INSTALL_DIR:-/Applications}"
REQUESTED_TAG="${LIFERAFT_VERSION:-latest}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only supports macOS." >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)
    ASSET_SUFFIX="mac-arm64.zip"
    ;;
  x86_64)
    echo "No Intel macOS release is published yet. Liferaft currently ships Apple Silicon builds only." >&2
    exit 1
    ;;
  *)
    echo "Unsupported macOS architecture: $ARCH" >&2
    exit 1
    ;;
esac

if [[ ! -x /usr/bin/python3 ]]; then
  echo "This installer needs /usr/bin/python3 to parse the GitHub release metadata." >&2
  exit 1
fi

if [[ "$REQUESTED_TAG" == "latest" ]]; then
  RELEASE_API_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  RELEASE_API_URL="https://api.github.com/repos/${REPO}/releases/tags/${REQUESTED_TAG}"
fi

echo "Fetching Liferaft release metadata from GitHub..."
RELEASE_JSON="$(curl -fsSL "$RELEASE_API_URL")"

ASSET_URL="$(
  RELEASE_JSON="$RELEASE_JSON" /usr/bin/python3 -c '
import json
import os
import sys

suffix = sys.argv[1]
release = json.loads(os.environ["RELEASE_JSON"])

for asset in release.get("assets", []):
    url = asset.get("browser_download_url") or asset.get("url")
    name = asset.get("name", "")
    if name.endswith(suffix) and "blockmap" not in name:
        print(url)
        raise SystemExit(0)

raise SystemExit(f"No release asset ending with {suffix!r} was found.")
' "$ASSET_SUFFIX"
)"

TAG_NAME="$(
  RELEASE_JSON="$RELEASE_JSON" /usr/bin/python3 -c '
import json
import os

release = json.loads(os.environ["RELEASE_JSON"])
print(release["tag_name"])
'
)"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ZIP_PATH="${TMP_DIR}/liferaft.zip"
APP_PATH="${TMP_DIR}/Liferaft.app"
TARGET_PATH="${INSTALL_DIR}/Liferaft.app"

echo "Downloading ${TAG_NAME}..."
curl -fL --progress-bar "$ASSET_URL" -o "$ZIP_PATH"

echo "Extracting app bundle..."
ditto -x -k "$ZIP_PATH" "$TMP_DIR"

if [[ ! -d "$APP_PATH" ]]; then
  echo "The downloaded archive did not contain Liferaft.app." >&2
  exit 1
fi

INSTALL_CMD=(ditto "$APP_PATH" "$TARGET_PATH")
REMOVE_QUARANTINE_CMD=(xattr -dr com.apple.quarantine "$TARGET_PATH")

if [[ -w "$INSTALL_DIR" ]]; then
  rm -rf "$TARGET_PATH"
  "${INSTALL_CMD[@]}"
  "${REMOVE_QUARANTINE_CMD[@]}" || true
else
  echo "Administrator access is required to install into ${INSTALL_DIR}."
  sudo rm -rf "$TARGET_PATH"
  sudo "${INSTALL_CMD[@]}"
  sudo "${REMOVE_QUARANTINE_CMD[@]}" || true
fi

echo "Liferaft ${TAG_NAME} installed to ${TARGET_PATH}"
echo "You can launch it from Applications."
