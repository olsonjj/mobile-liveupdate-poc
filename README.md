# Roll-Your-Own Ionic Live Updates POC

A throwaway proof-of-concept for shipping web-asset changes to a Capacitor iOS
app at runtime without going through the App Store — a simpler, self-hosted
alternative to Ionic AppFlow's Live Updates feature.

> ⚠️ **Insecure by design.** This is a POC only: plain HTTP, no payload signing,
> no integrity verification beyond an `index.html` presence check. **Do not ship
> this code to real users.** See the limitations section below and `PRD.md`.

## Status

The **server** workspace (`packages/server`) is implemented: a Fastify +
TypeScript app that serves `GET /api/updates/latest` from an on-disk
`manifest.json` and serves payload zips from `packages/server/payloads/`.
HTTP contract tests are in place.

The **app** workspace (`packages/app`) is scaffolded as an Ionic + Angular 22 +
Capacitor (iOS only) project. It ships a minimal Hello World UI that renders
the build number and greeting from a `version.ts` constant, plus a disabled
"Roll Back" button (no previous bundle to roll back to yet). The iOS platform
is added, `npx cap sync ios` succeeds, and the app launches in the iOS
simulator showing "Build: 1 / Hello World".

The inlined live-update plugin's **state + version-check** slice is implemented
(issue 04): a TypeScript API (`src/plugins/live-update/`) backed by a native
Swift `LiveUpdatePlugin` (`CAPPlugin` + `CAPBridgedPlugin`) shipped as a local
Capacitor plugin package (`packages/app/live-update-plugin/`, consumed via a
`file:` dependency — not a separate pnpm workspace package, per PRD user story
4). On cold launch the app calls `ensureStorage()` → `getState()` →
`checkForUpdate()` non-blocking, surfacing "current: N, server: M, update
available: yes/no" in the UI. The on-device layout `Library/Application
Support/liveupdates/{current,previous,state.json}` is created on first launch
and is inspectable via `xcrun simctl get_app_container`. The download/unzip
(06), atomic swap (07), and WebView reload (08) slices are now implemented:
the full update pipeline runs — `prepareUpdate` → `applyUpdate` → `reload` —
so publishing build N+1 on the server and foregrounding the app shows the
"Updating…" overlay followed by a reload displaying build N+1's greeting.
Rollback (09) is implemented: the "Roll Back" button flips `current/www/` and
`previous/www/` and reloads to the prior build. End-to-end error-path
hardening + DoD verification (10) is complete — every failure mode (corrupt
zip, missing-`index.html` zip, swap-move failure, `state.json`-write failure)
was verified on the iOS simulator to leave the active bundle running and
`state.json`/`current/` unchanged, and the full definition-of-done walkthrough
(launch build N → publish N+1 → foreground → update + reload → roll back →
reload to N) passes. See
[`docs/decisions/10-error-path-hardening.md`](docs/decisions/10-error-path-hardening.md).

The **foreground-resume trigger** slice is implemented (issue 05): on iOS the
app subscribes to `@capacitor/app`'s `appStateChange` event and, when the app
returns to the foreground (`isActive === true`), re-runs `checkForUpdate()`
silently — no overlay, no download (those arrive in 06–08). The result drives
a dedicated user-facing "Update available — build M" badge (`ion-badge`) that
appears only when `server.version > current`, and is hidden when equal/lower
or when a check fails. The cold-launch check reuses the same code path and
writes the verbose debug status line.

## Monorepo layout

```
.
├── PRD.md
├── README.md
├── package.json          # root (private), pnpm workspace tooling + dev scripts
├── pnpm-workspace.yaml   # declares packages/*
├── issues/               # slice-by-slice implementation plan
└── packages/
    ├── app/              # Ionic + Angular 22 + Capacitor (iOS only)
    │   ├── src/          #   version.ts + Hello World UI + plugins/live-update/ (TS API)
    │   ├── live-update-plugin/  # inlined native plugin (local SPM package, file: dep)
    │   ├── ios/          #   native Xcode project (iOS only, no Android)
    │   └── capacitor.config.ts
    └── server/          # Fastify + TypeScript manifest/payload server
        ├── src/          #   buildServer() + manifest reader + CLI entry
        ├── test/         #   Fastify `inject` contract tests
        ├── manifest.json #   seed manifest (version 1)
        └── payloads/     #   served at /payloads/*.zip (zips gitignored)
```

### The live-update plugin is inlined into the app package

Per an explicit decision in `PRD.md` (user story 4), the Capacitor live-update
plugin is **not** a standalone pnpm workspace package. It lives as a subfolder
inside `packages/app` — its TypeScript API (`src/plugins/live-update/`) sits
alongside the Angular source, and its native Swift code ships as a *local
Capacitor plugin package* at `packages/app/live-update-plugin/` (with its own
`Package.swift`), consumed by the app via a `file:` dependency. This is the
canonical way Capacitor's `cap sync` discovers and registers a local native
plugin class (it scans the package's Swift sources for `@objc(...)` and adds
the class to `packageClassList`, then links the SPM product into `CapApp-SPM`).

This keeps the plugin inlined within `packages/app` (no published package, no
separate workspace entry) while still using Capacitor's standard registration
path — the only deviation from the PRD's literal "under the iOS project"
wording, made necessary because Capacitor has no in-place registration hook for
arbitrary Swift files added directly to `CapApp-SPM`'s sources.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10
- Xcode (for the iOS simulator; added in a later slice)

## Getting started

```sh
pnpm install
```

Root convenience scripts orchestrate the workspaces:

```sh
pnpm dev:server   # start the Fastify server (later slice)
pnpm dev:app      # run the Ionic app (later slice)
pnpm build        # build all workspaces
pnpm test         # run tests across all workspaces
```

## Decision notes

- [`docs/decisions/08-reload-webview-9a.md`](docs/decisions/08-reload-webview-9a.md)
  — the WebView is reloaded from the new bundle using Capacitor's
  `CAPBridgeProtocol.setServerBasePath(_:)` (PRD approach 9a). The fallback
  runtime-module-swap (9b) is **not** implemented because 9a is feasible
  with a ~10-line native method and no `CAPBridge` subclassing.
- [`docs/decisions/10-error-path-hardening.md`](docs/decisions/10-error-path-hardening.md)
  — the four PRD failure modes (corrupt zip, missing-`index.html` zip,
  swap-move failure, `state.json`-write failure) were verified on the iOS
  simulator to leave the active bundle running and `state.json`/`current/`
  unchanged. The two internal failure modes (swap-move, state-write) are
  exercised via debug-only, env-gated fault injection (`LIVEUPDATE_FAULT`);
  the DoD walkthrough's rollback step is driven via a debug-only
  `LIVEUPDATE_AUTO_ROLLBACK` hook. Both hooks are no-ops in a normal app
  run. The full definition-of-done walkthrough (launch build N → publish N+1
  → foreground → update + reload → roll back → reload to N) passes.

## Verified error-path behaviour (issue 10)

Every failure mode during the update process was verified on the iOS
simulator to leave the **active bundle running** and `state.json` /
`current/www/` **unchanged** — a failed update is equivalent to no update
having been attempted (PRD user story 40):

| Failure mode | Trigger | Result on failure |
| --- | --- | --- |
| Corrupt / incomplete zip | `payloads/build-3-corrupt.zip` (random bytes, no EOCD) | `prepareUpdate` rejects after `unzip` throws; `staging/` + temp zip cleaned; overlay dismissed |
| Zip missing `index.html` | `payloads/build-3-noindex.zip` (valid zip, only `readme.txt`) | `prepareUpdate` rejects after the `index.html` guard; `staging/` cleaned; overlay dismissed |
| Directory-move failure | `LIVEUPDATE_FAULT=swap` (debug injection) | `applyUpdate` restores the temp backup into `current/`; new bundle left in `staging/`; state untouched |
| `state.json`-write failure | `LIVEUPDATE_FAULT=stateWrite` (debug injection) | `applyUpdate` restores directories (current→staging, previous→current); state never written |

In all four cases the app continued showing the previously active bundle.
See `docs/decisions/10-error-path-hardening.md` for the full verification
record and the screenshot set under `screenshots/issue10-phase*`.

## Definition of done (POC)

Open the app in the iOS simulator showing "Build: N / Hello World"; publish
build N+1 on the server; bring the app to the foreground; observe the
"Updating…" overlay, the download/swap, and the reload showing
"Build: N+1 / Hello World v2"; tap "Roll Back" and observe the app reload
showing "Build: N" again. A failed update (e.g. a corrupt zip) must leave
build N running.

See `PRD.md` for the full problem statement, solution, user stories, and
implementation decisions.
