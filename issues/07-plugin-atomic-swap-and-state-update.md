# Plugin: atomic swap + state.json update

## What to build

After a successful staging (issue 06), perform the atomic swap to make the staged bundle the new active bundle:

1. Move the existing `current/` to `previous/` (overwriting any prior `previous/`).
2. Move the staged bundle into `current/`.
3. Update `state.json` to `{ "current": <newVersion>, "previous": <oldCurrent> }` (where `oldCurrent` is `null` if there was no prior current).
4. Dismiss the "Updating…" overlay.

The swap must be atomic in spirit: if any step fails (directory move, state write), the plugin must restore the prior directory arrangement and leave the active pointer unchanged. The active bundle must never be left in a half-written state.

This slice does not reload the WebView — the app still shows the old version on screen after a successful swap. The reload comes in issue 08.

## Acceptance criteria

- [ ] After a successful swap, `current/www/` holds the newly downloaded bundle
- [ ] After a successful swap, `previous/www/` holds the prior bundle (or `previous/` is empty/absent if there was no prior current)
- [ ] After a successful swap, `state.json` reads `{ "current": <newVersion>, "previous": <oldCurrent> }`
- [ ] The "Updating…" overlay is dismissed after the swap
- [ ] If the directory move fails, the prior arrangement is restored and `current/` is unchanged
- [ ] If the `state.json` write fails, the prior arrangement is restored and `state.json` is unchanged (or restored to its prior contents)
- [ ] The app still shows the old version on screen after this slice (reload is a later slice)
- [ ] The new state is inspectable via `xcrun simctl get_app_container`

## Blocked by

- Issue 06 (Plugin: download + unzip + validate to staging, with "Updating…" overlay)
