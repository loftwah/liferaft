# Liferaft agent entry point

## Delivery showcase

The owner's Discord showcase is the running record of delivered project work.
The integrator alone announces one coherent outcome per meaningful stage, not
individual worker activity or every commit. Follow the shared
[showcase contract](https://github.com/loftwah/woodhouse-new/blob/main/docs/DISCORD_SHOWCASE.md)
tracked in [Woodhouse #171](https://github.com/loftwah/woodhouse-new/issues/171).

- Use `MERGED_TO_MAIN` for integrated code, never as a shipped claim.
  `PRODUCTION_VERIFIED` requires the actual released source/version and a real
  affected-flow live check. `DOCS_TOOLING_DONE` means non-runtime work is on
  `main` with its focused check; do not redeploy an unchanged product.
  Use `BLOCKED` or `RELEASE_FAILED` with the exact reason and next action.
- Include the project, issue/PR links and real issue state, source/version,
  what changed, why it matters, where/how to inspect it, verified scope and
  remaining limits. Include relevant inspected, public-safe screenshots when
  useful; never secrets, private content or unapproved artwork.
- Use a trusted local Woodhouse checkout, with this repository as the working
  directory: `node /path/to/woodhouse-new/scripts/showcase-delivery.mjs /path/to/public-safe-event.json --send`.
  Omit `--send` for the default dry run; inspect the result first. Never
  download and execute moving remote code. Check the canonical implementation
  is available and verified before use; these instructions are not send proof.
- `WOODHOUSE_DISCORD_CHANNEL` is a secret webhook URL, not a numeric channel ID
  (`WOODHOUSE_DISCORD_WEBHOOK_URL` is an optional alias). Supply it through
  the actual runtime's shared host environment/private store, never tracked
  files, payloads, screenshots or logs. Missing configuration/send failure is a
  notification fault to report, not a reason to block an otherwise safe product
  release or claim the notification succeeded. Reconcile uncertain sends before
  retrying; do not duplicate posts.
- Keep issue/release evidence authoritative and preserve this project's release,
  safety and explicit hold boundaries. Do not add GitHub Actions, infrastructure
  or a second deployment system for announcements.


## Desktop release and privacy boundaries

Liferaft is a local, read-only MBOX recovery app. Preserve source archives and
private message/attachment data; use fictional examples for public evidence.
A web/build smoke is not desktop acceptance: report the exact installer version,
OS/architecture and actual installed-app import/search/preview/export checks.
Unverified platforms remain explicitly unverified. Do not trigger GitHub Actions
or bypass OS security prompts to obtain a showcase receipt.
