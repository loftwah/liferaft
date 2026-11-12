# Rune adoption assessment

Assessed: 2026/11/12 Australia/Melbourne (AEDT, UTC+11); 2026/11/12 UTC.

## Decision

Keep Liferaft's Electron/React renderer for this update. Rune is a credible
candidate for a bounded, optional visual surface, but a working integration has
not been demonstrated. Do not add a dependency or advertise Rune support until
the packaged-app proof below passes.

This decision is based on a concrete compatibility boundary: Rune's browser
runtime compiles WebAssembly, while the current renderer's Content Security
Policy forbids that compilation. The same renderer displays untrusted archived
email. Changing its execution policy to obtain a cosmetic improvement needs an
explicit architecture review, not an incidental dependency upgrade.

**Confidence: 95%** in this adoption decision. Runtime, GPU and installed-app
compatibility remain unverified.

## Evidence snapshot

Liferaft source inspected: [`9519e87d3624c840b8abb9e5ad448b23753420f5`][liferaft].
Rune source inspected: [`ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c`][rune].
These are evidence references, not dependencies installed by this change.
The accompanying toolchain update moves Liferaft to Electron 45 while retaining
its Electron/React architecture; it does not add Rune.

Rune is Anomaly's MIT-licensed, GPU-rendered Rust UI framework. It is pre-release;
upstream asks consumers to pin a `dev` commit. Its `rune-kit` provides themed Rust
components; `rune-theme-opencode` supplies OpenCode's visual theme. Neither is a
React component library. A complete migration would introduce a Rust frontend
and new build and distribution work. [Rune README][rune-readme],
[component documentation][rune-kit].

The experimental browser target compiles Rust to WASM and renders through
WebGPU. `App::canvas_id` can mount a surface into an existing page;
`AppHandle::quit` handles teardown. Only one Rune app runs per page. There is no
WebGL fallback or browser networking layer. `App::web_document()` has a DOM
mirror and static HTML export, but that does not establish accessibility parity
for an embedded recovery workflow. [Browser documentation][rune-web].

## Fit with Liferaft

| Area           | Baseline Liferaft                                                                                   | Consequence for Rune                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Electron 41, React 19, Tailwind 4, Electron Vite                                                    | Rune would add a second rendering/runtime toolchain.                                                                      |
| Packaged entry | `BrowserWindow.loadFile`, with a development URL only in development                                | Prove loading bundled WASM, fonts and snippets from the installed app; an HTTP development demo is insufficient.          |
| Isolation      | Context isolation, sandbox and web security enabled; Node integration disabled                      | Retain these settings. Never enable Node in the renderer to make Rune work.                                               |
| CSP            | `script-src 'self'`, `connect-src 'self'`, `frame-src 'none'`                                       | External connections and frames are blocked; same-origin connections are allowed. WASM compilation is not authorised.     |
| Email preview  | DOMPurify-sanitised HTML plus a plain-text view; preview images are removed                         | Preserve the HTML/text preview and its isolation. No Rune replacement for arbitrary email HTML has been demonstrated.     |
| Search results | `react-virtuoso` virtualisation                                                                     | Preserve large-result behaviour; a new canvas list needs measured keyboard, selection and performance parity.             |
| Archive access | Typed `window.liferaft` preload API; SQLite, archive reads and export dialogs in Electron processes | Keep filesystem and database operations behind that API. Rune should receive bounded display data, not filesystem access. |
| Exports        | Electron native save/folder dialogs                                                                 | Retain the existing export path and cancellation behaviour. Browser Rune does not replace it.                             |

Source: Liferaft's pinned [manifest][manifest], [startup][startup],
[renderer policy][csp], [renderer][renderer], [preload][preload] and
[export implementation][exporter].

### CSP is a real integration requirement

The CSP specification blocks WASM byte compilation when the effective
`script-src` omits both `'wasm-unsafe-eval'` and `'unsafe-eval'`.
`'wasm-unsafe-eval'` is a narrower capability than JavaScript `'unsafe-eval'`;
it is not itself evidence of an insecure application. It is nevertheless a new
execution capability in Liferaft's email-bearing renderer, so this update does
not add it. [CSP specification][wasm-csp], [MDN explanation][mdn-csp].

Do not use `'unsafe-eval'`, `webSecurity: false`, disabled sandboxing, a protocol
with `bypassCSP`, a remote CDN, or runtime downloads as shortcuts. If a dedicated
trusted origin is proposed later, it must serve only explicitly bundled assets,
reject traversal, keep mail content outside that origin, and have reviewed
capabilities. Electron documents custom protocols as an alternative to `file://`,
including opt-in fetch support; that is additional architecture work, not proof
that the existing app can load Rune. [Electron protocols][protocol].

## Smallest useful next experiment

1. Build a separate proof using fictional archive counts and a read-only storage
   visualisation. Keep import, search, preview and export in React. Do not use
   private archives to produce screenshots or fixtures.
2. Pin Rune, commit the Cargo lockfile and retain licence notices. The inspected
   upstream toolchain is Rust 1.99.1. Its web build requires the WASM target,
   Python 3.11+ and the `wasm-bindgen` CLI matched to its lockfile. Bundle all
   generated assets; do not fetch them from the internet at runtime.
   [Toolchain][toolchain], [build script][web-build].
3. Resolve the execution boundary before integration. Compare a separately
   isolated trusted web surface with an optional native Rune process. The latter
   avoids changing the email renderer's CSP but adds native binaries and a new
   narrowly scoped IPC contract. Neither path is implemented here.
4. Demonstrate the real installed Electron build with networking unavailable:
   first frame, actual GPU adapter, missing-adapter fallback, Unicode text,
   resize, focus traversal, screen reader output, reduced motion, cleanup and
   repeated opening. Keep the existing React view available on every failure.
5. Record binary size, startup latency, memory use and a user-visible benefit
   against the existing screen. Reject adoption if it adds maintenance cost
   without improving recovery. Any later expansion needs import/search/preview/
   export acceptance on each released OS and architecture.

## What was verified here

- Read the pinned upstream source and Liferaft startup, rendering and IPC paths.
- Checked this environment: `rustc`, `cargo`, `rustup` and `wasm-bindgen` were
  absent, so no Rune binary was compiled.
- Attempted a minimal Chromium proof using Liferaft's exact CSP and an empty
  WASM module, with Chromium sandboxing enabled. Chromium exited before page
  load because creating its process-singleton socket was denied:
  `socket() failed: Operation not permitted`.

The browser attempt establishes an environment limitation only. It does not
verify Electron behaviour, file-URL fetching, GPU availability or Rune rendering.
The CSP conclusion is based on the inspected policy and published specification.
No Rune integration, installer or platform acceptance is claimed by this document.

[liferaft]: https://github.com/loftwah/liferaft/tree/9519e87d3624c840b8abb9e5ad448b23753420f5
[rune]: https://github.com/anomalyco/rune/tree/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c
[rune-readme]: https://github.com/anomalyco/rune/blob/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c/README.md
[rune-kit]: https://github.com/anomalyco/rune/blob/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c/crates/rune-kit/README.md
[rune-web]: https://github.com/anomalyco/rune/blob/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c/WEB.md
[toolchain]: https://github.com/anomalyco/rune/blob/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c/rust-toolchain.toml
[web-build]: https://github.com/anomalyco/rune/blob/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c/scripts/web-build.sh
[manifest]: https://github.com/loftwah/liferaft/blob/9519e87d3624c840b8abb9e5ad448b23753420f5/package.json
[startup]: https://github.com/loftwah/liferaft/blob/9519e87d3624c840b8abb9e5ad448b23753420f5/src/main/index.ts
[csp]: https://github.com/loftwah/liferaft/blob/9519e87d3624c840b8abb9e5ad448b23753420f5/src/renderer/index.html
[renderer]: https://github.com/loftwah/liferaft/blob/9519e87d3624c840b8abb9e5ad448b23753420f5/src/renderer/App.tsx
[preload]: https://github.com/loftwah/liferaft/blob/9519e87d3624c840b8abb9e5ad448b23753420f5/src/preload/index.ts
[exporter]: https://github.com/loftwah/liferaft/blob/9519e87d3624c840b8abb9e5ad448b23753420f5/src/main/exporter.ts
[wasm-csp]: https://www.w3.org/TR/2026/WD-CSP3-20261027/#can-compile-wasm-bytes
[mdn-csp]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution
[protocol]: https://www.electronjs.org/docs/latest/api/protocol
