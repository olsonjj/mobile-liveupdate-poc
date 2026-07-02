# Plugin: foreground resume trigger for the version check

## What to build

Extend the plugin from issue 04 so that the version check also fires when the app returns to the foreground (resume), not only on cold launch. The foreground check must be non-blocking and silent: it loads the existing active bundle first and runs the check in the background.

When the server version is greater than the local current version, the UI should surface an "update available" indicator (reusing the surface from issue 04). No download, overlay, or swap happens in this slice — only the second trigger and the indicator.

## Acceptance criteria

- [x] The version check fires on app foreground/resume events, not only on cold launch
- [x] The foreground check is non-blocking and silent (no overlay, no download)
- [x] When the server version is greater than local, the UI shows an "update available" indicator
- [x] When the server version is equal or lower, no indicator is shown
- [x] Demoable: bump the server version, background the app, resume it, and observe the "update available" indicator appear without any download occurring

## Blocked by

- Issue 04 (Plugin: on-device state management + version check)
