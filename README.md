# Liferaft

Liferaft searches local MBOX archives and recovers messages and attachments.
[Visit liferaft.loftwah.com](https://liferaft.loftwah.com/) for downloads and the
recovery walkthrough.

## Recover something

1. Extract an MBOX file from your mail export, such as Google Takeout. Keep the
   original MBOX available while you work.
2. Choose **Add archive**. Liferaft opens the source read-only and builds a
   separate local index. You can cancel indexing from the toolbar.
3. Search for a filename, sender, subject or phrase. Use **Show filters** to
   narrow the search, or use shortcuts such as `filename:invoice`,
   `from:alice`, `has:attachment`, `after:2026-01-01` and
   `before:2026-11-12`. For an exact attachment filter, use
   `filename:"April invoice" filetype:pdf`. Both filters must match the same
   attachment: `filename:` looks for part of its name and `filetype:` checks
   its extension. The results list displays up to 500 matches.
4. Select a result to read the headers and inspect the attachment details.
   **Recover** saves an attachment. **Recover .eml** saves the original message.
   Existing files at the destination are kept.

**Cmd+O** opens the archive chooser and **Cmd+F** focuses search on macOS. Tab
moves between controls. When a result has focus, the arrow keys move through the
results. Use **Reindex archive** if the source changed, or **Remove local index**
to reclaim index space while keeping the source.

The Rune preview shows selectable plain text and converts HTML-only mail to
passive text. It displays up to 24,000 body characters and 100 attachment
descriptions. Messages over 16 MiB can be recovered as `.eml` without previewing
them. The importer processes messages up to 64 MiB each and needs disk space
for the index. Reindexing may temporarily need space for two copies of the index.

## Downloads and source

[Download Liferaft v0.3.1](https://github.com/loftwah/liferaft/releases/download/v0.3.1/Liferaft-0.3.1-mac-arm64.dmg)
for Apple silicon Macs on macOS 13.5 or later. Open the DMG, drag Liferaft into
Applications and try opening it. The build is unnotarised. If macOS blocks it
and you trust the download, follow Apple’s [Open Anyway instructions](https://support.apple.com/en-us/102445).
The [release notes](https://github.com/loftwah/liferaft/releases/tag/v0.3.1)
include the SHA-256 checksum. The [earlier v0.1.2 release](https://github.com/loftwah/liferaft/releases/tag/v0.1.2)
uses Electron and includes Windows and Linux installers.

Rune reuses the existing catalogue, indexes and agent settings in
`~/Library/Application Support/liferaft` on macOS. Quit older Liferaft builds
before switching. An index that lacks recovery identity metadata needs
reindexing. Reindex a compatible older archive if you need to search text
in its HTML-only messages.

[Agent access](docs/AGENT_RECOVERY.md) is optional and starts off. You approve
the archives and recovery folder. Your chosen local agent may send returned mail
details to its model provider.

## Build and package

Use the [pinned toolchain and packaging guide](docs/toolchain.md). To report a
problem, open an [issue](https://github.com/loftwah/liferaft/issues) and include
the version and platform. Use fictional mail in anything you attach.

[MIT licence](LICENSE) · [Woodhouse project](https://woodhouse.loftwah.com/projects/liferaft/)
