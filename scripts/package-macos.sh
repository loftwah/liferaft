#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
root="$PWD"
if [[ "$(uname -sm)" != "Darwin arm64" ]]; then
  echo "The native packaging target is macOS on Apple silicon." >&2
  exit 1
fi

version="$(node -p "require('./package.json').version")"
node_version=24.22.1
rune_revision=ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c
if [[ "$(bun --version)" != 1.4.4 || "$(node -p process.versions.node)" != "$node_version" ]]; then
  echo "Use Bun 1.4.4 and Node $node_version to package Liferaft." >&2
  exit 1
fi
if [[ -n "${LIFERAFT_NOTARY_PROFILE:-}" && -z "${LIFERAFT_SIGN_IDENTITY:-}" ]]; then
  echo "Notarisation requires a Developer ID Application signing identity." >&2
  exit 1
fi

destination="${1:-$root/release}"
mkdir -p "$destination"
destination="$(cd "$destination" && pwd -P)"
artifact="$destination/Liferaft-$version-mac-arm64.dmg"
[[ ! -e "$artifact" ]] || { echo "Choose a different output folder. $artifact already exists." >&2; exit 1; }
scratch="$(mktemp -d "${TMPDIR:-/tmp}/liferaft-package.XXXXXXXX")"
trap 'rm -rf "$scratch"' EXIT
app="$scratch/Liferaft.app"
resources="$app/Contents/Resources"
engine="$resources/engine"
mkdir -p "$app/Contents/MacOS" "$engine"
(cd native && MACOSX_DEPLOYMENT_TARGET=13.0 cargo build --locked --release)
install -m 755 native/target/release/liferaft "$app/Contents/MacOS/Liferaft"
bun build src/native/engine.ts --target=node --packages=external --outfile="$engine/engine.mjs"
cp package.json bun.lock "$engine/"
(cd "$engine" && bun install --production --frozen-lockfile --ignore-scripts)
rm "$engine/package.json" "$engine/bun.lock"
find "$engine/node_modules/better-sqlite3/prebuilds" -type f ! -name darwin-arm64.node -delete
test -f "$engine/node_modules/better-sqlite3/prebuilds/darwin-arm64.node"

archive="node-v$node_version-darwin-arm64.tar.gz"
dist="https://nodejs.org/dist/v$node_version"
curl -fsSL --retry 2 "$dist/$archive" -o "$scratch/$archive"
curl -fsSL --retry 2 "$dist/SHASUMS256.txt" -o "$scratch/SHASUMS256.txt"
(
  cd "$scratch"
  awk -v file="$archive" '$2 == file { print }' SHASUMS256.txt > node-checksum.txt
  shasum -a 256 -c node-checksum.txt
  tar -xzf "$archive" --strip-components 1 "node-v$node_version-darwin-arm64/bin/node" "node-v$node_version-darwin-arm64/LICENSE"
)
install -m 755 "$scratch/bin/node" "$engine/node"
cp "$scratch/LICENSE" "$resources/Node-LICENSE"
cp LICENSE "$resources/Liferaft-LICENSE"
curl -fsSL --retry 2 "https://raw.githubusercontent.com/anomalyco/rune/$rune_revision/LICENSE" -o "$resources/Rune-LICENSE"

iconset="$scratch/Liferaft.iconset"
mkdir "$iconset"
for points in 16 32 128 256 512; do
  sips -z "$points" "$points" build/icon.png --out "$iconset/icon_${points}x${points}.png" >/dev/null
  pixels=$((points * 2))
  sips -z "$pixels" "$pixels" build/icon.png --out "$iconset/icon_${points}x${points}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$resources/Liferaft.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Liferaft</string>
  <key>CFBundleDisplayName</key><string>Liferaft</string>
  <key>CFBundleIdentifier</key><string>com.loftwah.liferaft</string>
  <key>CFBundleExecutable</key><string>Liferaft</string>
  <key>CFBundleIconFile</key><string>Liferaft.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>13.5</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
plutil -lint "$app/Contents/Info.plist"

identity="${LIFERAFT_SIGN_IDENTITY:--}"
if [[ "$identity" == - ]]; then
  codesign --force --sign - "$engine/node" "$engine/node_modules/better-sqlite3/prebuilds/darwin-arm64.node"
  codesign --force --sign - "$app"
else
  cat > "$scratch/node-entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
PLIST
  codesign --force --sign "$identity" --timestamp --options runtime "$engine/node_modules/better-sqlite3/prebuilds/darwin-arm64.node"
  codesign --force --sign "$identity" --timestamp --options runtime --entitlements "$scratch/node-entitlements.plist" "$engine/node"
  codesign --force --sign "$identity" --timestamp --options runtime "$app"
fi
codesign --verify --deep --strict "$app"
(cd "$engine" && ./node --input-type=commonjs -e 'const DB = require("better-sqlite3"); const db = new DB(":memory:"); db.exec("CREATE VIRTUAL TABLE probe USING fts5(body)"); db.close()')
hdiutil create -quiet -srcfolder "$app" -volname Liferaft -format UDZO "$scratch/Liferaft.dmg"
if [[ "$identity" != - ]]; then
  codesign --sign "$identity" --timestamp "$scratch/Liferaft.dmg"
fi
if [[ -n "${LIFERAFT_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$scratch/Liferaft.dmg" --keychain-profile "$LIFERAFT_NOTARY_PROFILE" --wait
  xcrun stapler staple "$scratch/Liferaft.dmg"
  xcrun stapler validate "$scratch/Liferaft.dmg"
fi
mv "$scratch/Liferaft.dmg" "$artifact"
(cd "$destination" && shasum -a 256 "$(basename "$artifact")" > "$(basename "$artifact").sha256")
printf '%s\n' "$artifact"
