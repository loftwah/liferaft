# Rune adoption

The owner authorised a complete native Rune replacement in [#12](https://github.com/loftwah/liferaft/issues/12).
The earlier assessment of embedding Rune WebAssembly inside the Electron
renderer remains in Git history. Native Rune removes that renderer boundary.

Liferaft pins [Rune ea6ddf8f](https://github.com/anomalyco/rune/tree/ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c)
and Rust 1.99.1. The application Cargo manifest applies Rune’s consuming-workspace
patches for wgpu-hal, winit, Parley and Windows AccessKit. Rune owns the desktop
window, native file and folder dialogs, indexed virtual rows, keyboard input,
selectable text and accessibility tree.

The recovery engine remains TypeScript and SQLite. A packaged plain Node child
serves the Rune process over inherited pipes. It accepts one size-bounded,
validated request at a time. A worker thread owns the active index build and
reports progress. Closing the private pipe cancels owned work and drains it
before closing SQLite. A filesystem lock fences other native writers while the
engine is still running. A private export journal lets either engine remove
owned partial files after a process crash when the original destination folder
is still available and its identity matches. MCP uses the separate stdio entry point and read-only
database handles. It exposes the existing five scoped tools.

Existing data is read in place. Index rebuilds preserve the archive ID, build
a separately named index and switch the catalogue to it only after the worker
has exited successfully. Cancellation keeps the previous row. On restart the
engine marks interrupted imports failed and removes unreferenced Rune index
files from its own archive directory. Legacy grants keep the existing version-1
format. Older indexes lacking recovery identity metadata have a reindex path.

Native previews use a bounded HTML-to-text conversion that drops images,
link destinations and executable or interactive elements. Rune renders
mail as plain, selectable text. It opens no links and fetches no email
resources. Reindex legacy HTML-only mail to add its converted text to search.

[Toolchain and packaging](toolchain.md) · [Observed verification](verification.md)
