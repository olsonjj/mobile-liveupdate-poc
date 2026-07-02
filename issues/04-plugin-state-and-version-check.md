# Plugin: on-device state management + version check

## What to build

Create the live-update Capacitor plugin, inlined as a subfolder inside `packages/app` (a TypeScript API plus native Swift under the iOS project — not a separate workspace package).

The plugin must, on the device:

1. Ensure the storage layout exists at `Library/Application Support/liveupdates/` with `current/` and `previous/` subdirectories.
2. Read and write a `state.json` file alongside those directories, shaped as:
   ```json
   { "current": <int|null>, "previous": <int|null> }
   ```
3. Fetch `GET /api/updates/latest` from the server and compare the returned integer `version` against the locally recorded current version. An update is available iff `server.version > local.current`.

Wire the app to call the plugin's check on **cold launch** (non-blocking — the app loads its current bundle first). Surface the result in the UI so the developer can see "current: N, server: M, update available: yes/no". No download or swap happens in this slice — only state management and the check.

On a very first launch (no `state.json` yet), the plugin should initialize `state.json` with `{ "current": null, "previous": null }` and treat the app-bundle build number as the local baseline for comparison.

## Acceptance criteria

- [ ] The plugin's TypeScript API and native Swift implementation exist inlined under `packages/app`
- [ ] On first launch, `state.json` is created at `Library/Application Support/liveupdates/state.json` with `{ "current": null, "previous": null }`
- [ ] The `current/` and `previous/` subdirectories exist under `Library/Application Support/liveupdates/`
- [ ] On cold launch, the plugin fetches the manifest and compares `server.version` against `local.current` (or the app-bundle baseline when `current` is null)
- [ ] The UI surfaces whether an update is available (e.g. "current: 1, server: 2, update available")
- [ ] The check is non-blocking — the app shows its current bundle immediately
- [ ] `state.json` is inspectable via `xcrun simctl get_app_container` and reflects the expected values

## Blocked by

- Issue 02 (Server: manifest endpoint + static payload serving)
- Issue 03 (App: Hello World UI with build number + greeting on iOS sim)
