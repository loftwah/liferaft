# Toolchain and packaging

Use Rust 1.99.1 from `native/rust-toolchain.toml`, Node 24.22.1 and Bun 1.4.4.
Cargo and Bun use committed lockfiles.

```sh
bun install --frozen-lockfile
bun run check
(cd native && cargo fmt --check && cargo test --locked)
bun run dev
```

The development binary uses Node from PATH. For fixture work, set
`LIFERAFT_DATA_DIR` to an absolute path in a new temporary directory. A normal
macOS launch uses the existing Liferaft Application Support directory.

## Apple silicon DMG

Run `bun run dist -- /absolute/output/directory` on Apple silicon. It builds
Rune with a macOS 13 deployment target. The bundle minimum is macOS 13.5
to match the bundled Node binary. The packager verifies the pinned Node distribution’s
checksum and includes the application, Node, production JS dependencies and the
arm64 SQLite prebuild. The script verifies the bundle signature and creates an
FTS5 table with the bundled engine before making the DMG and its SHA-256 file.
No development runtime is needed to run the installed bundle.

The public v0.3.1 DMG uses ad-hoc signing and is labelled unnotarised.
For notarised distribution, use a configured Developer ID Application identity as
`LIFERAFT_SIGN_IDENTITY` and a preconfigured notarytool Keychain profile as
`LIFERAFT_NOTARY_PROFILE`. The script signs, submits, staples and validates the
DMG in that mode. Keep Apple credentials in the authorised local store.

After qualifying a distributable package from reviewed main, publish the DMG
and checksum to this repository’s GitHub Releases and update the site’s
version and download destination. A local package does not imply publication.
The earlier Electron release remains available through GitHub Releases.
