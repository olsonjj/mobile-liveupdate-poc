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

- [ ] A centered "Updating…" overlay is shown over the WebView when an update is being processed
- [ ] The zip is downloaded from `manifest.url` to a temp location
- [ ] The zip is unzipped into a staging directory under `Library/Application Support/liveupdates/`
- [ ] The staged bundle is validated to contain an `index.html` at its root
- [ ] On success, the staged bundle is inspectable via `xcrun simctl get_app_container`
- [ ] On a corrupt zip, the staging/temp directories are cleaned up, the overlay is dismissed, and `current/` is unchanged
- [ ] On a zip missing `index.html`, the staging/temp directories are cleaned up, the overlay is dismissed, and `current/` is unchanged
- [ ] `state.json` is not modified by this slice

## Blocked by

- Issue 05 (Plugin: foreground resume trigger for the version check)
