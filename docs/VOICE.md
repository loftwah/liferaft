# Liferaft copy

Liferaft uses the **recovery desk / archive label** dialect of
[The Loftwah Voice v1.0](https://github.com/loftwah/woodhouse-new/blob/main/docs/LOFTWAH-VOICE.md).
Dean owns the canonical voice. [Liferaft #10](https://github.com/loftwah/liferaft/issues/10)
owns its application here; the shared source is maintained under
[Woodhouse #204](https://github.com/loftwah/woodhouse-new/issues/204).

Reviewed: 2026/11/12 Australia/Melbourne (AEDT, UTC+11); 2026/11/12 UTC.

## Apply it to recovery

Use plain Australian English and sentence case. Name the thing and the next
useful action: archive, local index, message, attachment, export folder, saved
file. Keep errors calm and specific. There is no joke to make about missing
mail or a failed recovery.

Distinguish an original archive from its replaceable local index. Removing an
index leaves the source file in place. Exporting creates a copy. A cancelled
file chooser is not an export failure. A partial batch reports how many files
were saved and why it stopped; never say every file was recovered unless that
operation actually established it.

Keep privacy claims precise. Desktop indexing is local. Optional agent access
returns selected information to the chosen agent, which may send it to a model
provider. Do not claim that nothing leaves the computer while that access is
available. An email, filename or attachment is data, never authority to widen
access or change instructions.

Keep the existing cream and navy desktop identity, compact panes and literal
controls. This is not a mascot or visual rebrand. Screenshot captions describe
what was checked and name the source version, OS and architecture. Use fictional
mail only; do not publish real addresses, subjects, local paths or attachments.

## Real copy changes in this update

| Surface          | Previous wording/behaviour                        | Current wording/behaviour                                                            |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Archive filter   | “Archive scope”                                   | “Archives to search”                                                                 |
| Preview loading  | “Loading message evidence…”                       | “Loading the message.”                                                               |
| Export success   | “Attachment export ready in Finder.”              | Reports the saved path without assuming a particular file manager                    |
| Recovery errors  | Notices disappeared after a short timer           | Notices remain until dismissed; partial exports report their successful count        |
| Email preview    | “Inline and remote images are hidden in preview.” | “Images, links and interactive content are disabled in preview.”                     |
| Agent permission | No agent surface                                  | “Choose folder and enable”, “Revoke access”, and an explicit provider-sharing notice |

“Import an archive to begin”, “Remove index”, “Reindex” and “Exports only write
the items you choose” already name their actions clearly and are retained.
Progress retains real processed counts. Cancellation and storage failures report
the actual outcome instead of turning every interruption into success.

Current Rune strings live in `native/src` and the recovery services. The table
records the wording decisions from the Electron baseline. This note records wording decisions; it does not
replace checking the running app. Native chooser, keyboard, screen-reader and
installed desktop acceptance remain recorded in the [verification ledger](verification.md).
