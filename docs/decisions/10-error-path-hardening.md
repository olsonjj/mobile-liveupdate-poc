# Decision 10: End-to-end error-path hardening + DoD verification

**Status:** adopted (issue 10)
**Relates to:** `PRD.md` → "Update flow (error path)" + "Definition of done",
`issues/10-e2e-error-hardening-and-dod-verification.md`,
`issues/06-plugin-download-unzip-validate-staging.md`,
`issues/07-plugin-atomic-swap-and-state-update.md`

## Context

Issues 06–09 implemented the update pipeline (`prepareUpdate` → `applyUpdate`
→ `reload`) and the rollback flow, with restore-on-failure logic in the native
`LiveUpdatePlugin`. Issue 10's job is to *verify* — on the iOS simulator, not
just by code review — that every failure mode during the update process leaves
the active bundle pointer untouched and the app running the previously active
bundle, and then to run the PRD's definition-of-done walkthrough end to end.

The PRD calls out four failure modes that must not corrupt state:

1. A corrupt or incomplete zip download.
2. A zip that unzips successfully but is missing `index.html`.
3. A failure during the directory move (the staging → current swap).
4. A failure during the `state.json` write (after the swap succeeded).

Modes 1 and 2 are externally triggerable: a bad payload on the server is
exactly what the app would see. Modes 3 and 4 are *internal* to the swap —
there is no external input that makes `FileManager.moveItem` or
`Data.write(…, options: .atomic)` fail on the simulator, so they cannot be
exercised without a fault-injection seam.

## Decision

### Modes 1 & 2: real bad payloads on the simulator

Verified directly by serving crafted payloads from the Fastify server and
foregrounding the app (the resume-check trigger, issue 05):

- **Corrupt zip** (`payloads/build-3-corrupt.zip`, 2 KB of random bytes — no
  end-of-central-directory record): `ZipExtractor.unzip` throws `noEOCD` inside
  `prepareUpdate`; the staging dir and temp zip are cleaned, the "Updating…"
  overlay is dismissed, and the promise rejects. `current/` and `state.json`
  are left untouched. **Verified:** `state.json` stayed
  `{ "current": 2, "previous": null }`, `current/www` still served build 2,
  and `staging/` was removed entirely.
- **Zip missing `index.html`** (`payloads/build-3-noindex.zip`, a valid zip
  containing only `readme.txt`): `ZipExtractor.unzip` succeeds, the
  `index.html`-exists guard in `prepareUpdate` throws `missingIndexHtml`, and
  the same cleanup/reject path runs. **Verified:** identical result —
  `state.json` and `current/` unchanged, `staging/` cleaned.

These exercise the `prepareUpdate` failure path (issue 06), which never touches
`current/`, `previous/`, or `state.json` by construction — the atomic swap is
a separate later step.

### Modes 3 & 4: debug-only, env-gated fault injection

Because no external input can make the in-swap `moveItem` or the post-swap
`state.json` write fail on the simulator, a small, clearly-marked fault seam
was added to `LiveUpdatePlugin`:

- `LIVEUPDATE_FAULT=swap` — throws inside the `do { … try fm.moveItem(staging
  → current) }` block in `performAtomicSwap` *after* the current bundle has
  been moved to a temp backup, so the real backup-restore path runs.
- `LIVEUPDATE_FAULT=stateWrite` — throws inside the `do { … try writeState(…) }`
  block *after* the swap has fully succeeded (current = new, previous = old),
  so the real directory-restore path runs (current → staging, previous →
  current).

The seam reads `ProcessInfo.processInfo.environment["LIVEUPDATE_FAULT"]` and is
**only settable via `simctl launch`** (`SIMCTL_CHILD_LIVEUPDATE_FAULT=…`); it is
never present in a normal app run, so production behaviour is unaffected. This
mirrors how Capacitor community live-update plugins expose debug hooks. The
faults throw a plain `NSError` *inside the existing `do/catch` blocks*, so the
restore logic that runs is the real, permanently-shipped code — not a copy.

**Verified (Mode 3, `LIVEUPDATE_FAULT=swap`):** after the failed swap,
`state.json` stayed `{ "current": 2, "previous": null }`, `current/www` still
served build 2 (restored from the temp backup), and `staging/www` held the
un-promoted build-3 bundle — exactly the restore semantics.

**Verified (Mode 4, `LIVEUPDATE_FAULT=stateWrite`):** after the failed state
write, `state.json` stayed `{ "current": 2, "previous": null }`,
`current/www` still served build 2 (the swapped-in build-3 bundle was moved
back to `staging/`, and the old-current was moved back from `previous/` to
`current/`), and `previous/` was empty — exactly the directory-restore
semantics. `state.json` was never updated because the throw happened before
`writeState` returned.

### A second debug hook for the DoD's rollback step

The PRD's definition of done ends with "tap *Roll Back* and observe the app
reload showing Build: N again." This agent harness has no Accessibility /
Input-Monitoring permission, so it cannot click the Simulator's UI (both
`CGEvent` posting and AppleScript `click at` are blocked by TCC). To verify the
rollback step of the DoD deterministically without a UI tap, a second
debug-only, env-gated hook was added:

- `LiveUpdatePlugin.debugEnv(_:)` — a `CAPPluginMethod` that reads a named
  launch environment variable and returns it (or null) to the JS layer.
- `AppComponent.ngOnInit` reads `LIVEUPDATE_AUTO_ROLLBACK` after its cold-launch
  check; the value is the build number to roll back *from*. When the *running*
  bundle's `VERSION` matches, `runRollBack()` is invoked (which calls the real
  `rollBack()` → `reload()` pipeline). This is one-shot per build: a
  rolled-back bundle has a different build number, so it won't match and won't
  loop. Never set in a normal app run; production behaviour is unaffected.

This was used to demonstrate the DoD's rollback step
(`LIVEUPDATE_AUTO_ROLLBACK=3` rolled the build-3 bundle back to build 2); the
same `rollBack` → `reload` code path is what the "Roll Back" button invokes, so
it verifies the real mechanism.

## Definition-of-done walkthrough (verified on the iOS simulator)

Run on the booted iPhone 17 simulator with the Fastify server on
`http://localhost:3000`:

1. **Launch** (fresh install, `state.json = {current:null, previous:null}`) →
   app shows **"Build: 1 / Hello World"** (app-bundle baseline).
   (`screenshots/issue10-phaseF-redo-build1.png`)
2. **Publish build N+1** (`build-2.zip`, manifest `version: 2`) via the manual
   publish workflow (`scripts/publish.mjs`).
3. **Background → foreground** the app (SpringBoard → relaunch) — the
   foreground-resume trigger (issue 05) fires the check.
4. The app shows the **"Updating…" overlay**, downloads/unzips/swaps, and
   **reloads to "Build: 2 / Hello World v2"**. `state.json` →
   `{current:2, previous:null}`. (`issue10-phaseF-redo-updated-build2.png`)
5. Repeat for build 3 → reloads to **"Build: 3 / Hello World v3"**,
   `state.json` → `{current:3, previous:2}` (rollback now enabled).
   (`issue10-phaseF-redo-updated-build3.png`)
6. **Roll back** (triggered via the `LIVEUPDATE_AUTO_ROLLBACK=3` debug hook,
   which invokes the real `rollBack` → `reload` pipeline) → app **reloads to
   "Build: 2 / Hello World v2"**, `state.json` → `{current:2, previous:3}`,
   `previous/www` now holds the build-3 bundle.
   (`issue10-phaseF-redo-rolled-back-build2.png`)

A failed update (corrupt zip / missing `index.html` / injected swap or
state-write fault) was confirmed to leave build N running in every case (Phases
B–E).

## Why the debug hooks are kept (not reverted)

They are env-gated (only settable via `simctl launch`, never in a normal app
run), zero-impact when unset (a single env-var read on the relevant code path),
and genuinely useful for re-verifying the error paths and rollback as the POC
evolves. Reverting them would make these failure modes unverifiable on the
simulator going forward. They are documented here as debug-only; the shipped
production behaviour (the restore logic in `performAtomicSwap` /
`performRollback` and the `prepareUpdate` cleanup) is unchanged and is the
code that actually ran during verification.

## Known limitations (POC-scoped)

- The fault-injection and `debugEnv` hooks are intentionally crude — they exist
  to make the unverifiable-on-simulator error paths testable for this throwaway
  POC. A real implementation would not ship them; it would instead have a
  proper native test harness (out of scope per the PRD's testing decisions).
- The "Updating…" overlay flash between swap-completion and the new bundle
  painting (documented in decision 08) is unchanged.
- Rollback is still manual (button or debug hook); no automatic
  crash-detection/heartbeat rollback (explicitly out of scope per the PRD).
