# Toolchain and packaging

Use Rust 1.99.1 from `native/rust-toolchain.toml`, Node 24.22.1 and Bun 1.4.4.
Cargo and Bun use committed lockfiles.

```sh
bun install --frozen-lockfile
bun run dev
```

The development binary uses Node from PATH. For fixture work, set
`LIFERAFT_DATA_DIR` to an absolute path in a new temporary directory. A normal
macOS launch uses the existing Liferaft Application Support directory.

Use the [two-minute verification and release budget](../AGENTS.md#completion-and-release-evidence).
Run a focused check for the change. `bun run test` runs the focused unit suite,
and `bun run test:integration` checks the real Node recovery paths.
`bun run check` runs both when the change warrants them. Run formatting,
typechecking or `cargo test --locked` from `native/` only when relevant.

## Apple silicon DMG

Run `bun run dist -- /absolute/output/directory` on Apple silicon. It builds
Rune with a macOS 13 deployment target. The bundle minimum is macOS 13.5
to match the bundled Node binary. The packager verifies the pinned Node distribution’s
checksum and includes the application, Node, production JS dependencies and the
arm64 SQLite prebuild. The script verifies the bundle signature and creates an
FTS5 table with the bundled engine before making the DMG and its SHA-256 file.
No development runtime is needed to run the installed bundle.

The public v0.3.2 DMG uses ad-hoc signing and is labelled unnotarised.
For notarised distribution, use a configured Developer ID Application identity as
`LIFERAFT_SIGN_IDENTITY` and a preconfigured notarytool Keychain profile as
`LIFERAFT_NOTARY_PROFILE`. The script signs, submits, staples and validates the
DMG in that mode. Keep Apple credentials in the authorised local store.

Build and smoke one distributable package from main. Publish that DMG and its
checksum to this repository’s GitHub Releases, then deploy and verify the
[site’s version and download destination](../site/README.md). For engine
changes, the [fixture check](verification.md#local-acceptance-steps) covers
recovery. The native protocol test can use the package directly by setting
`LIFERAFT_TEST_ENGINE` to its `engine.mjs` and running the test with the
bundled Node. This reuses the packaged engine build.

The earlier Electron release remains available through GitHub Releases.
