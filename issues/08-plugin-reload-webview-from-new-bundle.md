# Plugin: reload WebView from new bundle (9a, with 9b fallback)

## What to build

After a successful swap (issue 07), reload the WebView so the user actually sees the new bundle.

**Primary approach (9a):** redirect the Capacitor WebView to load from the writable bundle directory at `current/www/index.html`. This is off-road relative to Capacitor's sanctioned APIs — Capacitor's bridge is designed to serve assets from the read-only app bundle. Implementing 9a may require influencing or subclassing `CAPBridge` / the WebView server configuration, or using `WKWebView.loadFileURL(_:allowingReadAccessTo:)` semantics to point at the writable directory.

**Fallback approach (9b), only if 9a proves infeasible:** keep the app bundle's `public/` as the shell and have the Angular entrypoint fetch a manifest of asset URLs from the plugin, dynamically importing the latest JS bundle from the writable directory at runtime (JS module swapping rather than a full WebView reload). This is uglier and does not update `index.html` cleanly, but demonstrates the update flow.

On success, the app visibly shows the new build number and greeting after the update completes.

## Acceptance criteria

- [ ] After a successful swap, the WebView reloads and displays the new bundle's build number and greeting
- [ ] The primary approach (9a, redirecting the WebView to load from `current/www/index.html`) is attempted first
- [ ] If 9a is infeasible, the fallback (9b, runtime module swap from the shell) is implemented and documented
- [ ] The chosen approach is documented in the README or a decision note, including why the other was not used
- [ ] Demoable: publish build 2 on the server, foreground the app, watch the "Updating…" overlay followed by a reload showing "Build: 2 / Hello World v2" (or equivalent)

## Blocked by

- Issue 07 (Plugin: atomic swap + state.json update)
