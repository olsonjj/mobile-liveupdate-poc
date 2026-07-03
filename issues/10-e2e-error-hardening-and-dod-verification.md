# End-to-end error-path hardening + definition-of-done verification

## What to build

Harden and verify the full error path, then run the complete definition-of-done walkthrough on the iOS simulator.

**Error-path hardening:** confirm that every failure mode during the update process leaves the active bundle pointer untouched and the app running the previously active bundle. This includes:

- Corrupt or incomplete zip download
- Zip that unzips successfully but is missing `index.html`
- Failure during the directory move (e.g. simulated disk error or permission issue)
- Failure during the `state.json` write

In every case, the app must continue showing the currently active bundle with no broken state.

**Definition-of-done walkthrough:** execute the end-to-end scenario on the iOS simulator and confirm it passes:

1. App launches showing "Build: N / Hello World"
2. Publish build N+1 on the server (manual workflow: bump `version.ts`, build Angular, zip output, copy zip into `payloads/`, rewrite `manifest.json`)
3. Bring the app to the foreground
4. Observe the "Updating…" overlay, the download/swap, and the reload showing "Build: N+1 / Hello World v2"
5. Tap "Roll Back" and observe the app reload showing "Build: N" again

## Acceptance criteria

- [x] A corrupt zip leaves the active bundle running and `state.json`/`current/` unchanged
- [x] A zip missing `index.html` leaves the active bundle running and `state.json`/`current/` unchanged
- [x] A failure during the directory move restores prior state and leaves the active bundle running
- [x] A failure during the `state.json` write restores prior state and leaves the active bundle running
- [x] The definition-of-done walkthrough passes end-to-end on the iOS simulator: launch at build N → publish N+1 → foreground → update + reload to N+1 → roll back → reload to N
- [x] A note is added to the README documenting the verified error-path behaviors

## Blocked by

- Issue 09 (Manual rollback button)
