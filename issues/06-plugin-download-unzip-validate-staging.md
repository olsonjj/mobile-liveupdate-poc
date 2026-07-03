# Plugin: download + unzip + validate to staging, with "Updating…" overlay

## What to build

When the plugin detects an update is available (from issue 05), it must begin the update process up to — but not including — the atomic swap:

1. Show a centered "Updating…" overlay over the WebView.
2. Download the zip from `manifest.url` to a temporary directory.
3. Unzip it into a staging directory (separate from `current/` and `previous/`).
4. Validate that the unzipped bundle contains an `index.html` at its root.

On any failure in steps 2–4 (download error, unzip error, missing `index.html`), the plugin must clean up the staging/temp directories, dismiss the overlay, and leave the active bundle completely untouched. No state is mutated.

On success, the staged bundle sits in the staging directory, the overlay remains visible, and control is handed off to the next slice (atomic swap). This slice does not move anything into `current/` and does not reload the WebView.

## Acceptance criteria

- [x] A centered "Updating…" overlay is shown over the WebView when an update is being processed
- [x] The zip is downloaded from `manifest.url` to a temp location
- [x] The zip is unzipped into a staging directory under `Library/Application Support/liveupdates/`
- [x] The staged bundle is validated to contain an `index.html` at its root
- [x] On success, the staged bundle is inspectable via `xcrun simctl get_app_container`
- [x] On a corrupt zip, the staging/temp directories are cleaned up, the overlay is dismissed, and `current/` is unchanged
- [x] On a zip missing `index.html`, the staging/temp directories are cleaned up, the overlay is dismissed, and `current/` is unchanged
- [x] `state.json` is not modified by this slice

## Implementation notes

- New plugin method `prepareUpdate({ url })` on `LiveUpdatePlugin` (Swift + TS
  definitions). The app component auto-triggers it from `runCheck` whenever
  `checkForUpdate` reports `updateAvailable`; a `preparing` signal guards against
  a cold-launch + foreground-resume double-trigger.
- `checkForUpdate` now also returns the manifest's payload `url` so the JS layer
  can hand it straight to `prepareUpdate` without a second manifest fetch.
- The "Updating…" overlay is a native `UIView` added to the WebView's superview
  (semi-transparent black + centered white label), dismissed via a view tag. It
  is shown on entry to `prepareUpdate`, dismissed on failure, and left visible
  on success (the atomic-swap slice, issue 07, owns dismissing it after the
  reload).
- Download uses `URLSession.downloadTask` (streams to disk) into
  `NSTemporaryDirectory()`, then the file is moved to an owned temp path before
  the completion handler returns (the system temp file is deleted the moment
  the handler returns).
- Unzip is a tiny dependency-free `ZipExtractor` (pure Foundation + the
  `Compression` framework's `COMPRESSION_ZLIB` for raw RFC 1951 deflate). It
  parses the central directory for sizes/offsets, handles stored + deflate
  methods, and rejects zip-slip paths. Validated against a real `zip(1)`
  payload (15 files, deflate-compressed) and against corrupt + index-less zips
  (both throw and are caught by `prepareUpdate`'s error path).
- Staging lives at `<App Support>/liveupdates/staging/www/`. Each
  `prepareUpdate` starts by `cleanStaging()` (removes the whole staging dir) so
  a half-written staging dir from a prior crashed run can't poison the next
  attempt.
- `prepareUpdate` never touches `current/`, `previous/`, or `state.json`; on
  any failure it removes staging + the temp zip and dismisses the overlay. The
  active bundle pointer is never flipped by this slice.
- A `scripts/publish.mjs` helper (PRD user story 9) was added at the repo root
  (`pnpm publish:payload`) to drive the manual publish workflow: build the
  Angular app, zip `packages/app/www/` with `index.html` at the archive root,
  drop it in `packages/server/payloads/`, and rewrite `manifest.json`. The zip
  is produced with `index.html` at the root, which is the layout the validator
  checks for.
- Verified: `tsc --noEmit` passes for the app; server contract tests still
  pass (6/6); `cap sync ios` succeeds; `xcodebuild` for the iOS Simulator
  builds the plugin cleanly against Capacitor 8.

## Blocked by

- Issue 05 (Plugin: foreground resume trigger for the version check)
