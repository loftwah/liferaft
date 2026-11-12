# Liferaft verification

## 0.3.0 native Rune candidate

Verified 12 November 2026 in Melbourne. The native work starts at Liferaft
`7691f423dd3ea1f050cbec9a12552642ce6db2ae` (#11) and pins Rune
`ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c`. The delivery PR identifies the
source revision associated with the installed candidate.

- The local Apple silicon DMG is `Liferaft-0.3.0-mac-arm64.dmg`. Its SHA-256 is
  `f9d53c052570a5933b4e0fbab51dcefecf63f211f374afdffafc11d03f619574`.
  Tested on macOS 26.6.2 (25G83) arm64. The package contains Node 24.22.1 and
  the arm64 SQLite binding. Bundle signature verification and the packaged
  FTS5 probe passed.
- Mounted the DMG and installed to an isolated location with a separate
  catalogue. Used the native archive, save and folder dialogs. Recovered the
  fictional PDF and original `.eml`, opened the one-page PDF in Preview,
  matched both expected byte sequences, and checked the MBOX hash again.
  The PDF SHA-256 is
  `8b052b3da834eb019e1a199a92a41c6880a8ca401dff8cfd628650dad70bf6e2`.
- Verified Cmd+O, Cmd+F, Tab, Space, restored focus after save, native
  accessibility names, heading and checkbox roles, and readable previews.
  A 700-message HTML-only archive produced a capped, scrollable 500-result
  list and a selectable plain-text preview. Cancelled a 182,000-message
  fictional import while indexing, checked its temporary index was removed
  and verified the source checksum.
- Codex CLI 0.145.0 used the packaged `--mcp` entry point to list the grant,
  search, read the invoice and recover its PDF. The bytes matched the desktop
  export. Revoking access in Liferaft returned `access_disabled` to the
  client. OpenCode v2’s configuration is documented. Its local provider
  returned a quota error during its model run.
- Formatting, TypeScript, 34 Bun tests and 11 Node integration tests passed.
  The private-pipe regression covers a legacy catalogue row, recovery after
  reindex, HTML-only search and passive preview, stale selections, existing
  output collisions and exact exports. The crash test force-kills a fixture
  process and checks cleanup of its owned temporary after restart.
  An independent review exercised a real in-progress export and verified
  that pipe EOF aborted publication and removed the partial file.
- macOS Gatekeeper rejected the ad-hoc candidate for distribution. The host
  has Apple Development identities. A Developer ID Application identity and
  authorised notarisation profile are required for the public Rune release.
  Rune builds for Windows, Linux, Intel macOS and older macOS versions remain
  unverified. Spoken VoiceOver output remains unverified.

The [landing page](https://liferaft.loftwah.com/) serves the actual fictional
Rune capture as a local build and offers the published v0.1.2 installers.
HTTPS, canonical URLs, robots, sitemap, rendered phone and desktop layouts,
social artwork and the three linked v0.1.2 asset hashes were checked. Google
Search Console accepted the sitemap for the existing domain property.
The [Woodhouse project](https://woodhouse.loftwah.com/projects/liferaft/) and
[share collection](https://woodhouse.loftwah.com/share/liferaft/) use the
product-site destination and artwork.

## 0.2.0 catch-up evidence (historical)

Checked: 2026/11/12 Australia/Melbourne (AEDT, UTC+11); 2026/11/12 UTC.

## Scope and delivery state

Baseline: `9519e87d3624c840b8abb9e5ad448b23753420f5` on `main`.
The source and tests described here are committed with this document; the
associated pull request records the final source and merge commits. The source
version is **0.2.0**. This is not a claim that a 0.2.0 installer has been released.

The work updates the native toolchain, repairs source/export integrity, adds
optional scoped local MCP recovery, clarifies recovery copy and records the Rune
adoption decision. Existing owners remain [#3](https://github.com/loftwah/liferaft/issues/3),
[#5](https://github.com/loftwah/liferaft/issues/5),
[#7](https://github.com/loftwah/liferaft/issues/7),
[#8](https://github.com/loftwah/liferaft/issues/8),
[#9](https://github.com/loftwah/liferaft/issues/9) and
[#10](https://github.com/loftwah/liferaft/issues/10).

All recovery evidence uses fictional mail and task-owned temporary folders. No
private archive, screenshot or recovered document was added. No tag, GitHub
Actions run, public installer release, email or Discord announcement was created.
The existing release workflow's Bun/Node pins were aligned; its triggers were not
changed and the workflow was not executed.

## Environment and checks

Managed Linux x64 workspace, Node **24.22.1**, Bun **1.4.4**, Electron **45.3.1**
with embedded Node **24.22.2** and Node-API **10**. Native SQLite reports **3.54.1**
and supports FTS5. Exact dependencies are in `package.json` and `bun.lock`;
[toolchain.md](toolchain.md) explains the installation and packaging choices.

| Check                 | Evidence and limit                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline              | Existing 11 Bun tests, TypeScript and production build passed. Formatting already failed in AGENTS.md and the design router.                                                                                                                                                                                                                                       |
| Updated local check   | `bun run check` passed: formatting, 34 Bun unit/capability tests (148 assertions), 13 Node integration tests and TypeScript. The associated PR records the tested source.                                                                                                                                                                                          |
| Import/reindex        | Actual native SQLite tests cover source identity, fresh index revisions, cancelled/changed-source imports, attachment stream completion and stale desktop selections.                                                                                                                                                                                              |
| Exports               | Tests reproduce and prevent source overwrite, existing-file replacement, symlink destinations, concurrent collisions, decoding corruption and partial-output leaks. Byte-for-byte fictional PDF and .eml recovery pass.                                                                                                                                            |
| Passive HTML          | Actual DOMPurify with jsdom strips global styling, controls, navigation, media and script markup while retaining passive formatting. These are DOM tests, not a rendered accessibility test.                                                                                                                                                                       |
| MCP under Node        | Real importer, native catalogue/index and stdio tests cover the invoice workflow, scope denial, revocation, read-only handles, both protocol generations, fallback and EOF cleanup.                                                                                                                                                                                |
| MCP under Electron    | Four wire tests pass using the rebuilt Electron app in headless `--mcp` mode. The fifth suite test deliberately uses a controlled Node fixture to pause an export and prove cleanup before host exit.                                                                                                                                                              |
| Native packaging      | Linux x64 directory packaging, with publishing disabled. The ASAR whitelist excludes source, tests, docs, scripts, archives and agent tooling. Native SQLite loads from the package and passes an FTS5 write/search probe. The same four wire checks also pass through the final packaged executable; the fifth cleanup check remains the controlled Node fixture. |
| Production advisories | `bun audit --production` reported no advisories across 44 checked packages. This is a registry advisory result, not a guarantee that the software has no vulnerabilities.                                                                                                                                                                                          |
| Independent review    | Separate reviewers reproduced the attachment-only completeness bug, protocol-probe shutdown bug, EOF/export cleanup race and importer exit/delete race. Fixes and regression checks were completed before integration.                                                                                                                                             |

The new fictional PDF is structurally valid: Poppler extracts
“Fictional invoice from Alice - 123”. The fixture creator below supplies the
same bytes used by the native MCP test, together with their SHA-256 digest.

Final package inspection found that all 17 compiled output files byte-match the
ASAR; development packages, including jsdom, are absent. The local ASAR SHA-256 is
`25612cd903936ed73b7af3552fc3bdfd803c24b36c314f11ed4d9500d49b11a1`.

### Performance sample

One source comparison used a 1,435,483-byte MBOX with one 1 MiB attachment.
Both versions used the same current dependency tree and separate Node processes.
Baseline import time was **93.00 ms**; updated import time was **97.88 ms**.
Both indexed one message and one attachment, consumed every byte, preserved the
source digest and exited within the ten-second limit.

This single sample found no stall or material bottleneck. It does not establish
a speed improvement or a regression. Process startup/cache timings are not
presented as product performance, and historical dependencies were not recreated.

## Desktop acceptance boundary

A silent headless Electron GUI attempt, with Chromium sandboxing enabled, failed
before opening the window:

```text
chrome/browser/process_singleton_posix.cc:319
socket() failed: Operation not permitted (1)
```

The workspace blocks the Unix socket needed by Electron's desktop single-instance
mechanism. The environment's approval policy rejected a request to run that
scoped GUI check with additional execution permission. No security setting in the
product was weakened. The owned test process exited and its temporary profile
was removed. The headless MCP path does not use that desktop singleton and passed.

Consequently, this run does **not** establish native chooser behaviour, actual
Electron UtilityProcess import/quit behaviour, keyboard or screen-reader use,
rendered layout/contrast, or macOS/Windows installed acceptance. No new screenshot
is presented as rendered proof. The project design skill requires actual rendered
verification; that requirement remains open, with this concrete environment
blocker recorded rather than substituted by a source scan.

The final release check belongs to the developer/owner running a supported local
desktop, tracked in #3, #9 and #10. Resume using the exact merged source and record
the OS, architecture, app version and chosen client version. A local source app
check is useful; the distributed installer still needs its own affected-flow check.

## Local acceptance steps

Use Node 24.15 or newer within Node 24, and Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run check
bun run scripts/create-recovery-fixture.ts
bun run start:built
```

The fixture command prints a temporary MBOX path, a recovery folder and the
expected PDF path/digest. It contains no private data.

1. Import that MBOX and wait for one ready message and one attachment.
2. Search for `Alice invoice`, inspect the sender, subject and message reference,
   then export `invoice.pdf` to the printed recovery folder. Open it and compare
   it with the expected PDF. Cancel an additional export chooser and confirm that
   it creates no output and does not report a failure.
3. Open **Agent access**, select only this archive and the printed recovery
   folder, then read and confirm the sharing notice. Add the shown configuration
   to the local OpenCode or Codex version you intend to use.
4. Ask the agent to find Alice's invoice, show its source message and recover its
   PDF. Compare the resulting file's digest with the fixture's expected digest.
   The desktop export and agent export use different filenames, so they can
   coexist without overwriting one another.
5. Revoke access and confirm that subsequent agent search/export calls are
   denied. Reindex and confirm an old selection is rejected. Remove the local
   index and verify the original MBOX remains. Remove the temporary fixture folder
   after checking; leave personal archives and recovery files alone.

No API key, hosted service or new account is required for Liferaft itself. A
client's own model configuration remains that client's responsibility.

## Maintenance catalogue

This is the finite campaign ledger for [#8](https://github.com/loftwah/liferaft/issues/8),
not a new recurring release gate. **RUN** means the check was performed;
**ADAPTED** names its actual equivalent. **BLOCKED** marks evidence this environment
could not provide. The common base, candidate, environment and evidence above
apply to every row.

| ID  | Disposition       | Work, evidence and remaining boundary                                                                                                                                                                                         |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0  | RUN               | Mapped Electron/preload/renderer, utility importer, catalogue, indexes and recovery. Baseline checks preceded changes; reviewed actual issue owners.                                                                          |
| 1   | RUN               | Reproduced a serious export defect: selecting the source as destination truncated a 31-byte archive to zero. Exclusive atomic publication prevents that write.                                                                |
| 2   | RUN               | Repaired real failure handling: query errors no longer masquerade as no matches; failed previews/searches leave loading state; importer errors no longer silently skip an item.                                               |
| 3   | ADAPTED           | Existing local `check`, build and package path used. Pre-existing formatting failures repaired. Existing workflow runtime pins aligned, with no Actions execution.                                                            |
| 4   | RUN               | Inspected baseline-to-candidate interface changes and all preview/export callers. Added revision propagation through search, preload, IPC and renderer.                                                                       |
| 5   | RUN               | Removed three unused direct dependencies after checking source/configuration use. Kept mime-types because filename generation uses it. Whitelisted package contents.                                                          |
| 6   | RUN               | Replaced bespoke Darwin download/rebuild logic with the locked Electron installer; shared range validation, atomic publication and transfer decoding between GUI and MCP.                                                     |
| 7   | RUN               | Current maintainer/registry pins, frozen install, new Electron Vite/TypeScript configuration and native Node-API/package probes. See #3 and toolchain.md.                                                                     |
| 8   | RUN               | Measured the before/after synthetic import above. No meaningful slowness reproduced; no performance gain claimed or speculative optimisation added.                                                                           |
| 9   | ADAPTED / BLOCKED | Actual importer/native SQLite/recovery and Electron stdio exercised. GUI, UtilityProcess/native dialogs and installed OS/client acceptance remain blocked as described above; owner #9.                                       |
| 10  | ADAPTED / BLOCKED | Added labelled native HTML dialog/fieldset, visible focus, status/error announcements, persistent recovery notices and bounded scrolling. Actual keyboard/screen-reader/layout checks await a runnable desktop; owner #10/#7. |
| 11  | RUN               | Read-only source descriptors, capability grants, revision/source checks, overwrite/symlink/collision tests, passive HTML allowlist and production advisory scan. No private data used.                                        |
| 12  | RUN               | Retry receipts, output collisions, stale IDs, grant revocation, modern/legacy fallback, EOF during extraction and owned child exit-before-unlink checked. Full #5 retention acceptance is separate.                           |
| 13  | ADAPTED           | No Rails application. Inspected actual SQLite/FTS5 paths, kept parameterised queries and shared indexes, made MCP handles read-only and bounded metadata retrieval.                                                           |
| 14  | RUN               | Setup and release claims updated; source version distinguished from an installed release; documented reindexing, per-item bounds and agent/provider sharing.                                                                  |
| 15  | RUN               | Connected desktop controls to scoped MCP, exposed source identity and bounded errors; recorded Rune as assessed, not integrated. No placeholder endpoint or mandatory AI service.                                             |
| 16  | RUN               | Independent recovery/security/lifecycle review with reproduced findings and focused regression evidence.                                                                                                                      |
| 17  | ADAPTED / BLOCKED | Linux native package produced and inspected. No published installer or installed desktop release verified. Resume actual distribution acceptance under #3/#9.                                                                 |
| 18  | RUN               | Repaired AGENTS bootstrap with commands, conditional routes, privacy, authority and truthful completion. See workflow evidence below and #7.                                                                                  |
| 19  | ADAPTED / BLOCKED | Real upstream Impeccable installed, read and applied to changed controls/copy. Manual detector ran; rendered verification and a fresh local-client hook/discovery check remain open under #7.                                 |
| 20  | RUN               | No new reusable skill warranted. Existing project router, upstream design skill and concise recovery/voice docs cover the work without another workflow system.                                                               |
| 21  | RUN               | Kept a compact bootstrap and task-triggered references. Did not mandate memory calls, rule hashes or unrelated framework guidance. Canonical voice links retain ownership.                                                    |
| 22  | ADAPTED           | Repository work, connected GitHub, scoped parallel ownership and real local checks were exercised in this managed workspace. No installed personal Codex/OpenCode client or new cloud infrastructure is implied.              |

Catalogue accounting is recorded. Runtime delivery remains incomplete until its
installed checks pass; this ledger does not close #8 or its related runtime owners.

## Agent workflow and design evidence

The executing environment was this managed ChatGPT workspace. The available
Codex CLI reports **0.167.0-alpha.4**; OpenCode is not installed here. The wire
tests use the explicit test client, not a personal Codex/OpenCode session. The user-provided
instructions, repository AGENTS.md and the project design router were read.
Personal-context retrieval recovered the accepted local recovery boundaries and
existing MCP request. Repository files and linked owner issues remain the fallback;
optional memory is not a startup requirement, and no new memory service was added.

For UI work, the actual upstream **Impeccable 4.8.2** installer supplied a local
skill and **engine 0.1.21**. The context launcher ran once for
`src/renderer/App.tsx`; existing `.impeccable.md` supplied the product identity.
The relevant new-work/operate/clarify/audit/critique guidance and craft floor were
read. The changed controls retain the cream/navy recovery interface, label
permissions explicitly and expose loading/error/revocation states. No automatic
hook was installed or claimed active. The installed upstream bundle is ignored,
not copied into the application or committed as a second skill implementation.

A manual detector scan of four changed UI files reported no regex findings and
explicitly warned that DOM/layout/contrast rules had not run. DOMPurify security
checks passed separately. Neither result is a substitute for rendered review.
A pre-existing product screenshot was inspected for the established layout; it
is not new-build evidence and was not republished.

The local bootstrap is 6,366 bytes. For this UI task, the project design router,
product context and voice note add 10,850 bytes, for 17,216 bytes before the
selected upstream playbooks and session instructions. This measures the local
route rather than pretending AGENTS.md alone is the effective context. The
managed harness's full prompt budget is not inferred from repository file sizes.

Requirements are kept in the bootstrap/product notes. Changing source is
identified by Git revision, file and symbol, then checked again after changes.
No digest of every instruction or artificial 18 KB rule was introduced. The
canonical voice source and its compact local note cover creative handoffs without
copying a full portfolio guide into every session. Cloudflare/Wrangler, Rails,
Resend, an inbound-mail agent and hosted deployment are not dependencies of this
local Electron product.

## Remaining ownership

- **#3/#9/#10:** installed desktop and actual chosen-client acceptance, platform
  packaging/signing and release evidence. Resume on a supported local desktop.
- **#5:** importer/export teardown was improved, but the full cross-worktree
  retention, reservation and portfolio budget system is not implemented or
  claimed complete by this change. Existing acceptance criteria remain open.
- **#7:** local-client fresh-session discovery and rendered design verification
  remain unverified. The current workspace's successful execution is narrower
  evidence.
- **Rune:** adoption is deferred for the technical reasons and bounded experiment
  in [rune-assessment.md](rune-assessment.md). No Rune dependency or renderer is
  included in this source update.
