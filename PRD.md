# PRD: Roll-Your-Own Ionic Live Updates POC

## Problem Statement

As a mobile app team, we currently rely on Ionic AppFlow's Live Updates feature to ship web-asset changes to our iOS app without going through the App Store review process. We want to understand whether we can build a simpler version of this capability ourselves — downloading and swapping web assets at runtime — so that we control the mechanism end-to-end and aren't dependent on a third-party service for it.

We do not know whether this is technically feasible within Capacitor's WebView model, how much native code it requires, or how the failure/rollback story plays out in practice. We need a throwaway proof-of-concept that proves the mechanism works on an iOS simulator before we invest in a real implementation.

## Solution

From the developer's perspective: a monorepo containing an Ionic/Angular/Capacitor app (iOS only) and a local Fastify server. The app ships with a minimal "Hello World" UI displaying a build number and greeting. When the app launches or returns to the foreground, an inlined Capacitor plugin checks the server for a newer build number; if one exists, the plugin downloads a zip of new web assets, unzips them into a writable directory, swaps the active bundle, and reloads the WebView to show the new version. If the download/unzip/swap fails, the old bundle keeps running. The user can also manually roll back to the previous bundle via a button in the UI.

From the user's perspective: open the app on the iOS simulator, see "Build: 1 / Hello World". Bump and publish a new payload on the server as build 2. Bring the app to the foreground; watch it show an "Updating…" overlay, download the new bundle, and reload showing "Build: 2 / Hello World v2". If something looks wrong, tap "Roll Back" and the app reloads showing build 1 again.

## User Stories

1. As an app developer, I want a monorepo with separate `app` and `server` packages managed by pnpm workspaces, so that the two concerns are clearly separated for my own clarity.
2. As an app developer, I want the app package to be an Ionic + Angular 22 + Capacitor project, so that I'm working with the latest Ionic toolchain.
3. As an app developer, I want the server package to be a Fastify + TypeScript application, so that I have a modern, typed local server to serve manifests and payloads.
4. As an app developer, I want the live-update plugin code to live as a subfolder inside the app package rather than as a separate workspace package, so that I avoid the packaging overhead of a standalone plugin package for this throwaway POC.
5. As an app developer, I want the server to expose `GET /api/updates/latest` returning a JSON manifest, so that the app can check what the latest available build is.
6. As an app developer, I want the manifest to contain an integer `version`, a `url` to the payload zip, and a `createdAt` timestamp, so that the client has everything it needs to decide and download.
7. As an app developer, I want the server to serve static zip payload files from a `payloads/` directory, so that I can drop new zips in manually.
8. As an app developer, I want the server to read its current version from a JSON file on disk, so that I can bump the version by rewriting that file during my manual publish workflow.
9. As an app developer, I want to generate a new payload by manually running the Angular build, zipping the output, copying the zip into the server's `payloads/` directory, and bumping the version file, so that I have full manual control over the publish process for the POC.
10. As an app developer, I want the app to display a build number and a greeting string read from a `version.ts` constant, so that I can visually confirm which bundle is active.
11. As an app developer, I want to bump the build number and greeting in `version.ts` for each new payload, so that a successful update is immediately visible on screen.
12. As an app developer, I want the app to perform an update check on cold launch, so that a newly published build is picked up when the app starts.
13. As an app developer, I want the app to perform an update check when it returns to the foreground, so that a newly published build is picked up without a full relaunch.
14. As an app developer, I want the update check to be non-blocking, so that the app immediately shows its current bundle rather than waiting on the network.
15. As an app developer, I want the client to compare the server's integer build number against its locally stored build number, so that it only updates when the server's version is greater.
16. As an app developer, I want the client to store its current state in a `state.json` file on the device filesystem, so that I can inspect it during debugging.
17. As an app developer, I want the `state.json` to record the current and previous build numbers, so that the active and fallback bundles are self-describing.
18. As an app developer, I want downloaded bundles to live under `Library/Application Support/liveupdates/`, so that they persist in a writable, app-scoped location.
19. As an app developer, I want the active bundle to live at `current/www/` and the prior bundle at `previous/www/` within that directory, so that two-slot rollback is possible.
20. As an app developer, I want the plugin to download the new zip to a temporary location first, so that a failed download never corrupts the active bundle.
21. As an app developer, I want the plugin to unzip the payload and validate that it contains an `index.html` before swapping, so that a corrupt or incomplete payload cannot brick the app.
22. As an app developer, I want the plugin to atomically swap the new bundle into `current/` and move the old `current/` to `previous/` only after a successful unpack, so that the active bundle is never left in a half-written state.
23. As an app developer, I want the plugin to update `state.json` to reflect the new current and previous versions after a successful swap, so that the on-device record stays accurate.
24. As an app developer, I want the plugin to show a centered "Updating…" overlay over the WebView during the download/unzip/swap, so that the user understands the app is processing an update.
25. As an app developer, I want the overlay to disappear and the WebView to reload from the new bundle once the swap succeeds, so that the user sees the updated app.
26. As an app developer, I want the plugin to reload the WebView from the new bundle's `index.html`, so that the new web assets are actually executed.
27. As an app developer, I want the plugin to attempt redirecting the Capacitor WebView to load from the writable bundle directory (approach 9a), so that the cleanest reload mechanism is attempted first.
28. As an app developer, I want the plugin to fall back to a runtime module-swap approach (approach 9b) only if the WebView redirect proves infeasible, so that the POC can still demonstrate the update flow even if 9a is blocked by Capacitor internals.
29. As an app developer, I want any error during download, unzip, validation, or swap to leave the currently active bundle running, so that the app never shows a broken state due to a failed update.
30. As an app developer, I want a "Roll Back" button visible in the app UI, so that I can manually trigger a return to the previous bundle if the new one looks wrong.
31. As an app developer, I want the "Roll Back" button to be disabled when no `previous` bundle exists, so that I cannot attempt a rollback with nothing to roll back to.
32. As an app developer, I want tapping "Roll Back" to flip `state.json` so that `previous` becomes active, move the directories accordingly, and reload the WebView, so that the prior version is shown again.
33. As an app developer, I want the update check to run silently (no overlay) when no update is available, so that the normal app experience is uninterrupted.
34. As an app developer, I want the server to run over plain HTTP on localhost, so that I'm not dealing with TLS for a throwaway local POC.
35. As an app developer, I want the POC to be documented as insecure (no payload signing, no integrity verification beyond the index.html check), so that it's clear this code must not ship to real users.
36. As an app developer, I want to test exclusively on the iOS simulator, so that I'm validating real Capacitor/iOS native behavior without device-signing overhead.
37. As an app developer, I want the POC scoped to iOS only, so that I'm not spending effort on Android.
38. As an app developer, I want web-asset-only updates (no native code changes via the live update mechanism), so that the boundary between what can be hot-updated and what requires an App Store release is clear.
39. As an app developer, I want a clear definition of done (app launches showing build N, server serves build N+1, app updates on foreground and shows build N+1, user can roll back to build N), so that I know when the POC is complete.
40. As an app developer, I want errors during the update process to never flip the active-bundle pointer, so that a failed update is equivalent to no update having been attempted.

## Implementation Decisions

### Repository layout
- Monorepo at the project root using pnpm workspaces.
- Two workspace packages: `packages/app` and `packages/server`.
- A `pnpm-workspace.yaml` at the root declares `packages/*`.
- The live-update plugin is NOT a separate workspace package; it lives as a subfolder inside `packages/app` (TypeScript API plus native Swift under the iOS project).

### App package (`packages/app`)
- Scaffolds an Ionic + Angular 22 + Capacitor (latest) project.
- iOS platform only; no Android added.
- A `version.ts` constant exposes the current build number (integer) and greeting string; these are bumped manually per payload.
- The app UI renders the build number, the greeting, and a "Roll Back" button. The button is disabled when no previous bundle exists.
- The plugin's TypeScript API exposes methods to: get current state, check for update, download/unzip/swap, reload the WebView, and roll back.
- The plugin registers Capacitor lifecycle/listener hooks so that the update check fires on cold launch and on app foreground (resume) events, non-blocking.

### Server package (`packages/server`)
- Fastify + TypeScript.
- Serves `GET /api/updates/latest` returning a manifest read from a version file on disk (e.g. `manifest.json`), shaped as `{ version: number, url: string, createdAt: string }`.
- Serves static zip files from a `payloads/` directory at the URL referenced by `manifest.url`.
- Runs over plain HTTP on localhost (default port configurable, e.g. 3000).
- The current version is stored in a JSON file on disk so the manual publish workflow only needs to rewrite that file.

### Update manifest contract
- `GET /api/updates/latest` → `200 OK` with body:
  ```json
  { "version": <integer>, "url": "<http url to zip>", "createdAt": "<ISO 8601>" }
  ```
- The client treats `version` as a monotonically increasing integer; an update is performed iff `server.version > local.version`.

### On-device storage layout
- Root: `Library/Application Support/liveupdates/`
  - `current/www/` — the active web bundle (unzipped Angular build output including `index.html`)
  - `previous/www/` — the prior bundle, used for rollback
  - `state.json` — records `{ current: <int|null>, previous: <int|null> }`
- The original app-bundle `public/` assets are read-only and are never modified; they serve as the initial/fallback bundle only before the first successful update (or, if no `current` exists, the WebView loads from the app bundle).

### Update flow (happy path)
1. App launches or resumes → loads existing active bundle (app bundle on first run, otherwise `current/www/`).
2. Plugin fetches `GET /api/updates/latest` silently.
3. If `server.version > local.version`, show centered "Updating…" overlay.
4. Download the zip from `manifest.url` to a temporary directory.
5. Unzip and validate that an `index.html` exists at the bundle root.
6. Move the existing `current/` to `previous/` (overwriting any prior `previous/`), then move the new unzipped bundle into `current/`.
7. Update `state.json` to `{ current: server.version, previous: oldCurrent }`.
8. Reload the WebView from `current/www/index.html`.
9. Hide the overlay.

### Update flow (error path)
- Any failure in steps 4–7 (download, unzip, validation, directory move, state write) aborts the update.
- The active bundle pointer is never flipped on failure; the user continues to see the currently active bundle.
- The overlay is dismissed and, optionally, a transient error indicator may be shown (not required for done).

### Rollback flow (manual)
1. User taps "Roll Back".
2. Plugin checks `state.previous` is non-null; if null, the button is disabled and nothing happens.
3. Swap `current` and `previous` directories (the previous becomes the new current).
4. Update `state.json` accordingly (`current` becomes the rolled-back version; `previous` becomes what was current, or null if none).
5. Reload the WebView from the new `current/www/index.html`.

### WebView reload mechanism (decision 9a → 9b)
- Primary approach (9a): redirect the Capacitor WebView to load from the writable bundle directory using `WKWebView.loadFileURL(_:allowingReadAccessTo:)` semantics, overriding or reconfiguring where the Capacitor bridge resolves its server URL. This may require subclassing or otherwise influencing `CAPBridge` / the WebView server configuration. This is off-road relative to Capacitor's sanctioned APIs.
- Fallback approach (9b), used only if 9a proves infeasible: keep the app bundle's `public/` as the shell and have the Angular entrypoint fetch a manifest of asset URLs from the plugin, dynamically importing the latest JS bundle from the writable directory at runtime (JS module swapping rather than a full WebView reload). This is uglier and does not update `index.html` cleanly, but sidesteps the WebView re-pointing problem.

### Security (explicit non-decision)
- YOLO for the POC: plain HTTP, no payload signing, no asymmetric verification.
- The only integrity check is that the unzipped payload contains an `index.html`.
- A real implementation would require HTTPS plus a signed manifest (server signs `{ version, url, sha256 }` with a private key; the public key is bundled in the app; the plugin verifies the signature and the zip's SHA-256 before unpacking). This is explicitly out of scope for the POC and documented as a limitation.

### Publish workflow (manual)
1. Edit `version.ts` in the app: bump the integer build number and change the greeting string.
2. Run the Angular production build.
3. Zip the build output.
4. Copy the zip into `packages/server/payloads/`.
5. Rewrite the server's version file to reflect the new build number and the new zip's URL.

## Testing Decisions

### What makes a good test here
A good test exercises external behavior at the highest possible seam, not implementation details. For this POC, the only automated-testable seam is the server's HTTP contract, because the native plugin's interesting behavior (download, unzip, swap, reload, rollback) executes against the iOS simulator's filesystem and `WKWebView` and has no practical unit-test harness without a full device/UI automation setup — which is out of scope for a throwaway POC.

### Primary seam: server HTTP contract tests
- Module under test: `packages/server`.
- Tests exercise the Fastify server via real HTTP requests (or `inject`), treating the server as a black box.
- Covered behaviors:
  - `GET /api/updates/latest` returns `200` with a body matching `{ version: number, url: string, createdAt: string }`.
  - The returned `version` matches the version currently recorded in the server's on-disk version file.
  - Rewriting the version file on disk (simulating a manual publish) is reflected on the next request.
  - Static zip files under `payloads/` are served with the correct content type and bytes when requested via the manifest `url`.
  - Requesting a non-existent payload returns a `404`.
- Prior art: none — this is a greenfield repo with no existing tests. The Fastify `inject` pattern will be established here as the project's first test seam.

### Secondary seam (optional, only if included): pure TS logic from the plugin's TypeScript layer
- If the version-compare and `state.json` read/parse/write logic are extracted into pure functions (no bridge calls), they can be unit tested directly.
- This is optional and included only if a safety net on the rollback/state logic is desired; otherwise the single server seam is sufficient.

### Native plugin verification
- The native plugin (download → unzip → swap → reload → rollback) is verified manually on the iOS simulator, which is exactly what the definition of done specifies. No automated tests target the Swift/native layer.

## Out of Scope

- Payload signing, integrity hashing, or any cryptographic verification (YOLO for POC).
- HTTPS / TLS on the local server.
- Automatic runtime crash-detection rollback (heartbeat/watchdog). Rollback is manual via the button only.
- Android platform.
- Real device testing (iOS simulator only).
- Server-side build or CI/CD pipeline for payload generation (fully manual publish workflow).
- A standalone Capacitor plugin package (plugin is inlined into the app package).
- Updating native code (Swift/Obj-C, Capacitor runtime, plugin native side) via the live update mechanism — native changes require a full App Store release.
- Shipping this code to real users.
- A persistent error/telemetry reporting mechanism for failed updates.
- Multi-platform or per-bundle granularity in versioning (single global integer version only).

## Further Notes

- The hardest technical risk is approach 9a (redirecting the Capacitor WebView to load from a writable directory). Capacitor's bridge is designed to serve assets from the read-only app bundle; re-pointing it is off-road and may require influencing `CAPBridge` or the WebView server configuration. If 9a is blocked, the fallback (9b, runtime module swapping) is uglier but demonstrates the update flow.
- The two-slot storage layout (`current` / `previous`) is deliberately chosen over a single slot so that a broken payload never bricks the simulator and so that the manual rollback button has something to roll back to.
- `state.json` is stored alongside the bundles (rather than in Capacitor Preferences/UserDefaults) specifically so it can be inspected during debugging via `xcrun simctl get_app_container` — this was a deliberate choice for POC debuggability.
- The integer build number (rather than semver or string equality) was chosen to keep the compare logic trivial and avoid parser edge cases during the POC.
- Definition of done, restated: open the app in the iOS simulator showing "Build: N / Hello World"; publish build N+1 on the server; bring the app to the foreground; observe the "Updating…" overlay, the download/swap, and the reload showing "Build: N+1 / Hello World v2"; tap "Roll Back" and observe the app reload showing "Build: N" again. A failed update (e.g. corrupt zip) must leave build N running.
