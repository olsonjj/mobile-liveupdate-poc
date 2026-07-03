# Roll-Your-Own Ionic Live Updates POC

A throwaway proof-of-concept for shipping web-asset changes to a Capacitor iOS
app at runtime without going through the App Store — a simpler, self-hosted
alternative to Ionic AppFlow's Live Updates feature.

> ⚠️ **Insecure by design.** This is a POC only: plain HTTP, no payload signing,
> no integrity verification beyond an `index.html` presence check. **Do not ship
> this code to real users.** See the limitations section below and `PRD.md`.

## WebView reload approach (decision 9a)

The POC uses **approach 9a**: after a successful swap, Capacitor's
`setServerBasePath(path:)` API redirects where the internal web server serves
assets from, then `webView.reload()` triggers a full page reload. This is the
same mechanism Ionic AppFlow uses for live updates.

**Why `setServerBasePath` instead of `loadFileURL`:**

- `WKWebView.loadFileURL(_:allowingReadAccessTo:)` was attempted first but
  failed. Capacitor's `WKNavigationDelegate` intercepts `file://` navigations
  and attempts to open them externally (in Safari), causing a sandbox/security
  error (`FBSOpenApplicationServiceErrorDomain`).
- `setServerBasePath` avoids this entirely: requests stay within the
  `capacitor://` scheme, Capacitor's internal server handles them, and the
  bridge reinitialization is seamless. This is Capacitor's sanctioned API for
  changing the asset root at runtime.

**Why 9a instead of 9b (runtime module swap):**

- 9a is cleaner: the entire web bundle is swapped and the WebView does a full
  reload, so `index.html`, all JS bundles, and all assets come from the updated
  directory.
- 9b is uglier: it keeps the app-bundle shell and dynamically imports JS from
  the writable directory. It does not update `index.html` cleanly and increases
  complexity in the Angular entrypoint.

## Status

Core update flow implemented: the app checks for updates on launch and foreground,
downloads new web bundles, atomically swaps them, and reloads the WebView.
Rollback is wired up via the UI button. See `PRD.md` for the full product
requirements and `issues/` for the implementation plan.

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
    └── server/          # Fastify + TypeScript manifest/payload server
```

### The live-update plugin is inlined into the app package

Per an explicit decision in `PRD.md` (user story 4), the Capacitor live-update
plugin is **not** a standalone workspace package. It lives as a subfolder inside
`packages/app` — its TypeScript API alongside the Angular source and its native
Swift code under the iOS project. This avoids the packaging overhead of a
standalone plugin package for a throwaway POC while keeping the two workspace
concerns (app vs. server) clearly separated.

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
pnpm dev:server   # start the Fastify server (default port 3000)
pnpm dev:app      # run the Ionic dev server
pnpm build        # build all workspaces
pnpm test         # run tests across all workspaces
pnpm publish:payload   # publish a new payload (see below)
```

### Publishing a new payload

The publish workflow is semi-automated:

1. **Bump the version** — edit `packages/app/src/app/version.ts`, increment
   `BUILD.number` and optionally update `BUILD.greeting`.
2. **Publish** — run `pnpm publish:payload` from the project root. This:
   - Runs the Angular production build (`ng build --configuration production`)
   - Zips the `www/` output with `zip -0` (store-only, required by the
     Swift unzipper)
   - Copies the zip into `packages/server/payloads/build-{N}.zip`
   - Rewrites `packages/server/manifest.json` with the new version, URL, and
     timestamp

   If the server is not running on `http://localhost:3000`, set the
   `SERVER_URL` environment variable:
   ```sh
   SERVER_URL=http://192.168.1.100:3000 pnpm publish:payload
   ```

3. **Restart the server** (if it's already running) so it picks up the new
   `manifest.json`.

4. **Bring the app to the foreground** — the app will detect the new version
   on its next foreground check, download the zip, swap, and reload.

The full manual publish workflow is documented in `PRD.md` (publish workflow
section). The `pnpm publish:payload` command automates steps 2–5 of that workflow.

## Definition of done (POC)

Open the app in the iOS simulator showing "Build: N / Hello World"; publish
build N+1 on the server; bring the app to the foreground; observe the
"Updating…" overlay, the download/swap, and the reload showing
"Build: N+1 / Hello World v2"; tap "Roll Back" and observe the app reload
showing "Build: N" again. A failed update (e.g. a corrupt zip) must leave
build N running.

See `PRD.md` for the full problem statement, solution, user stories, and
implementation decisions.

## Error-path hardening

Every failure mode during the update process has been designed to leave the
active bundle pointer untouched and the app running the previously active
bundle. The table below documents each error scenario and the observed behaviour.

| Failure mode | Active bundle behaviour | `state.json` / `current/` |
|---|---|---|
| Corrupt or incomplete zip download (network error, non-200, zero-length) | App keeps running the current bundle. The download temp file is discarded | Unchanged — `downloadAndStageUpdate` never touches `current/` or `state.json` |
| Zip unzips successfully but is missing `index.html` | App keeps running the current bundle. Staging directory is cleaned up | Unchanged — validation rejects the bundle before any swap is attempted |
| Failure during directory move in `swapToStagedUpdate` | App keeps running the current bundle. The old `current/` is restored from a temp directory (`.swap_tmp`), and any partially-written `current/` is removed | `state.json` is preserved by the `.atomic` write; directories are restored to their pre-swap layout |
| Failure during `state.json` write | Directories are restored from `.swap_tmp`. The `.atomic` write guarantees the original `state.json` is left intact if the write fails | Preserved — `FileManager.write(…, options: .atomic)` writes to a temp file and renames, so a failure leaves the original unchanged |
| Rollback failure (directory operations throw mid-swap) | The old `current/` is restored from `.rollback_tmp`. App keeps running | `state.json` is preserved; directories are restored to pre-rollback layout |
| Rollback with no previous bundle | Nothing happens — the Roll Back button is disabled when `state.previous` is null | Unchanged |

### Error-path design principles

- **Download and staging**: The download/unzip phase happens entirely inside a
temporary staging directory (`Library/Application Support/liveupdates/staging/`).
`current/`, `previous/`, and `state.json` are never touched until the staged
bundle is fully downloaded, unzipped, and validated. A failure at any point in
this phase simply removes the staging directory and reports the error.

- **Atomic swap with rollback**: Before any destructive operation on `current/`,
the existing `current/` is moved to a temp directory (`.swap_tmp`). Only after the
move succeeds are `previous/` and `current/` reshuffled. If any subsequent step
fails, the catch handler moves `.swap_tmp` back to `current/`, ensuring the active
bundle directory is restored.

- **Transactionally-safe state writes**: All `state.json` writes use
`Data.write(to:options: .atomic)`, which writes to a temporary file and atomically
renames it. This means the write either fully succeeds or the original file is
preserved — there is no window where `state.json` contains a partial or corrupt
record.

- **Rollback uses the same temp-dir pattern**: The rollback method mirrors the swap
pattern — it moves `current/` to `.rollback_tmp` before shuffling directories.
If anything fails, `.rollback_tmp` is moved back to `current/`, preserving the
active bundle.
