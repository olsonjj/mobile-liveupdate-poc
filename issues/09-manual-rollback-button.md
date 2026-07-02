# Manual rollback button

## What to build

Enable the "Roll Back" button in the app UI so the user can manually return to the previous bundle when something looks wrong.

Behavior:

1. The "Roll Back" button is enabled if and only if `state.previous` is non-null. When `previous` is null (no prior bundle), the button is disabled.
2. Tapping the button flips the active bundle: the `previous/` bundle becomes the new `current/`, and the prior `current/` becomes the new `previous/`.
3. `state.json` is updated accordingly (`current` becomes the rolled-back version; `previous` becomes what was current, or null if none).
4. The WebView reloads from the newly active bundle.

## Acceptance criteria

- [ ] The "Roll Back" button is disabled when `state.previous` is null
- [ ] The "Roll Back" button is enabled when `state.previous` is non-null
- [ ] Tapping "Roll Back" swaps `current/` and `previous/` so the prior bundle becomes active
- [ ] `state.json` is updated to reflect the new `current` and `previous` values
- [ ] The WebView reloads from the rolled-back bundle
- [ ] Demoable: after updating to build 2, tap "Roll Back" and observe the app reload showing "Build: 1" (or the prior version)
- [ ] After rolling back, the button remains correctly enabled/disabled based on the new `state.previous`

## Blocked by

- Issue 08 (Plugin: reload WebView from new bundle)
