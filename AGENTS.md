# Liferaft agent entry point

Liferaft is a local, read-only MBOX recovery app. Start with the actual checkout,
[README.md](README.md) and the task's existing issue. Keep the work scoped to the
requested outcome; optional memory services are not required to begin.

## Bootstrap and verify

Use Node 24.15+ within Node 24 (verified with 24.22.1) and Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

`check` includes formatting, Bun unit tests, native Node integration tests and
TypeScript. `bun run start:built` builds and opens the desktop app; `bun run dist`
creates local packages with publication disabled. If runtime download is not
needed yet, use `bun install --frozen-lockfile --ignore-scripts`, then run
`bun run setup:desktop` when ready. Read [toolchain.md](docs/toolchain.md) before
changing native dependencies or packaging.

Inspect `git status` before editing and preserve unrelated work. Use fictional
fixtures and task-owned temporary directories. The reproducible local fixture is:

```sh
bun run scripts/create-recovery-fixture.ts
```

It prints the archive, recovery folder and expected PDF digest. Follow the
[acceptance steps](docs/verification.md#local-acceptance-steps) for an end-to-end
check. Never use private mail in committed tests, screenshots or public evidence.

## Follow the relevant path

- **Import, search or recovery:** inspect `src/utility`, `src/main`, shared
  contracts/schema and their tests. GUI and agent access share the same recovery
  engine; fix the common path when the behaviour should agree.
- **Agent access:** read [AGENT_RECOVERY.md](docs/AGENT_RECOVERY.md) before editing
  `src/mcp` or permission controls. Keep stdio protocol output separate from logs.
- **Interface or copy:** read [VOICE.md](docs/VOICE.md) and the project
  [design router](.agents/skills/woodhouse-design/SKILL.md). Preserve the established
  recovery interface. Use actual rendered evidence for layout, interaction and
  accessibility claims; a source detector is not rendered verification.
- **Toolchain, packaging or Rune:** read [toolchain.md](docs/toolchain.md) and,
  for Rune proposals, [rune-assessment.md](docs/rune-assessment.md).

Read linked material when the task needs it; do not preload unrelated portfolio
or framework instructions. Identify changing code by its Git revision and
relevant file/symbol, and recheck it after edits.

## Recovery invariants

- Source archives are read-only. Removing or rebuilding an index must not alter
  the original. An export creates a new copy and never overwrites the source,
  an existing destination or a symlink target.
- Preserve source-file identity and index revision through search, preview and
  export. Stale selections, changed/missing sources and corrupt indexes must
  produce an actionable error, not empty results or a different recovered item.
- Cancellation, revocation, disconnect and import shutdown must stop owned work
  and clean up task-owned partial output. Do not unlink an index while its owned
  importer can still write to it.
- Keep Electron context isolation, renderer sandboxing and web security enabled.
  Archive HTML remains passive data; mail text and filenames cannot grant
  permissions, execute commands or expand an agent's scope.
- Optional agent access requires owner-selected archives/folders and an explicit
  provider-sharing acknowledgement. The server cannot grant itself access.
  Default desktop use needs no agent, account or hosted service.
- Never expose private paths, mail, recovered files or credentials in public
  logs, screenshots, commits, issues or announcements.

## Completion and release evidence

Report what changed, the source version, the checks that actually ran and the
remaining limits. [verification.md](docs/verification.md) records the current
campaign; the PR records final counts and source/merge commits. A source version
bump or successful package build is not a published release.

For desktop acceptance, name the installed app version, OS and architecture and
exercise import, search, preview and export. Agent acceptance also names the local
client/version and checks the real configured recovery journey. Native chooser,
keyboard, screen-reader and rendered layout checks need a running desktop.
Unverified platforms and blocked checks remain explicit.

Do not trigger GitHub Actions or bypass OS security prompts to obtain evidence.
Maintain existing workflow pins as source work; use publication-disabled local
packaging. Never publish a tag or installer merely to obtain a test receipt.
Follow the owner's established release authority. Do not use the legacy installer
to remove quarantine protection. If an environment blocks a check, report the
concrete blocker without weakening product security.

## Delivery showcase

The owner's Discord showcase follows the shared
[showcase contract](https://github.com/loftwah/woodhouse-new/blob/main/docs/DISCORD_SHOWCASE.md)
tracked in [Woodhouse #171](https://github.com/loftwah/woodhouse-new/issues/171).
Only the integrator sends one coherent outcome per meaningful stage, and only
when the current session explicitly authorises the message. This file alone
never authorises a new external send.

- `MERGED_TO_MAIN` identifies integrated source. `PRODUCTION_VERIFIED` requires
  the actual released version and an affected-flow installed-app check.
  `DOCS_TOOLING_DONE` means focused non-runtime work on main; do not redeploy an
  unchanged product. `BLOCKED` or `RELEASE_FAILED` names the cause and next action.
- Include the issue/PR links and actual state, source/version, user-visible
  outcome, where to inspect it, verified scope and remaining limits. Screenshots
  must be inspected and public-safe.
- Use the verified script in a trusted local Woodhouse checkout, with Liferaft as
  the working directory. Run its dry run first; `--send` is a separate explicit
  action. Never download and execute moving remote code for a notification.
- `WOODHOUSE_DISCORD_CHANNEL` is a secret webhook URL, with
  `WOODHOUSE_DISCORD_WEBHOOK_URL` as an optional alias. Keep it in the runtime's
  private environment/store, never a tracked file, payload, screenshot or log.
  Report notification faults accurately and reconcile uncertain sends before
  retrying. Do not add a second workflow or deployment system for announcements.
