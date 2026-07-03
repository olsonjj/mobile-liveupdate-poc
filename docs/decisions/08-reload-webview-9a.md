# Decision 08: Reload WebView from the new bundle — approach 9a (`setServerBasePath`)

**Status:** adopted (issue 08)
**Supersedes (within this POC):** approach 9b (runtime module swap)
**Relates to:** `PRD.md` → "WebView reload mechanism (decision 9a → 9b)",
`issues/08-plugin-reload-webview-from-new-bundle.md`

## Context

After the atomic swap (issue 07) the on-disk `current/www/` directory holds
the newly-downloaded bundle, but the Capacitor `WKWebView` is still rendering
whatever it loaded at startup — the read-only app bundle's `public/` assets.
Issue 08 must make the WebView actually *run* the new bundle's `index.html`
and assets so the user sees the updated build number + greeting.

The PRD lists two candidate mechanisms:

- **9a (primary):** redirect the Capacitor WebView to load from the writable
  bundle directory (`current/www/index.html`). The PRD flagged this as "off-road
  relative to Capacitor's sanctioned APIs" and possibly requiring
  `CAPBridge` subclassing or `WKWebView.loadFileURL` plumbing.
- **9b (fallback):** keep the app bundle as a shell and dynamically import the
  latest JS bundle from the writable directory at runtime (JS module swap).

## Decision

**Adopt 9a.** Capacitor's public `CAPBridgeProtocol` already exposes the
exact escape hatch this needs:

```swift
@objc func setServerBasePath(_ path: String)
```

`CAPPlugin.bridge` is a weak `id<CAPBridgeProtocol>`, so the inlined
`LiveUpdatePlugin` can call `self.bridge?.setServerBasePath(currentWWWPath)`
directly. Under the hood Capacitor:

1. updates its `WebViewAssetHandler`'s asset path to the new directory, and
2. reloads the WebView to its local URL (`capacitor://localhost/…`),

so `index.html` and every referenced asset (JS chunks, CSS, images) are then
served out of the writable `Library/Application Support/liveupdates/current/www/`
directory. No `CAPBridge` subclassing, no manual `WKWebView.loadFileURL`, no
private API, and no Angular-side shell/module-swap hackery.

This is the same mechanism community Capacitor live-update plugins
(e.g. `@capgo/capacitor-updater`) use; it works because the app has read
access to its own `Application Support/` directory.

## Why 9b was not used

9b was only ever a fallback "if 9a proves infeasible". 9a is feasible with a
~10-line native method, so 9b's downsides (doesn't update `index.html`
cleanly, requires an Angular-side manifest+dynamic-import shim, uglier
UX) are unnecessary. 9b is therefore **not implemented**.

## Implementation

- Native: `LiveUpdatePlugin.reload(_:)` in
  `packages/app/live-update-plugin/ios/Sources/LiveUpdatePlugin/LiveUpdatePlugin.swift`.
  Validates `current/www/index.html` exists, then calls
  `viewController.setServerBasePath(path: currentBundleURL.path)` on the main
  thread (the **view-controller** variant, not the bridge variant — see
  the "Gotcha" note below). On failure rejects and leaves the WebView on its
  current bundle; the `state.json` active pointer is never changed by
  `reload`.
- TS: `reload(): Promise<ReloadResult>` added to
  `packages/app/src/plugins/live-update/definitions.ts`.
- JS wiring: `AppComponent` calls `reload()` immediately after `applyUpdate`
  succeeds (issue 06→07→08 pipeline), and also on cold launch when
  `state.current !== null && state.current !== VERSION` so an already-applied
  update persists across launches (otherwise killing & relaunching the app
  would silently show the stale app-bundle baseline again).

## Known limitations (POC-scoped)

- **Brief flash of the old bundle.** `applyUpdate` (issue 07) dismisses the
  "Updating…" overlay on swap completion; `reload()` then re-points the
  WebView. Between overlay-dismiss and the new bundle painting there can be a
  sub-second flash of the old build. Acceptable for a POC; a production
  implementation would keep the overlay up until the new `WKNavigation`
  finishes (which requires hooking the bridge's `WebViewDelegationHandler`,
  out of scope here).
- **Cold-launch restore causes a one-time reload.** On cold launch with an
  applied update, the WebView first loads the app-bundle baseline, then
  `reload()` navigates to `current/www/`. This is a visible extra load. A
  production implementation would re-point the server base path in
  `CAPPlugin.load()` (before the WebView's initial load) — not done here to
  keep the slice boundary with issue 07 clean.
- **No reload-completion callback.** `reload()` resolves once
  `setServerBasePath` has been called, not once the new `index.html` has
  finished loading. The reloaded bundle's own `ngOnInit` is the implicit
  "reload complete" signal.

## Gotcha: two `setServerBasePath` entry points

Capacitor v8 exposes *two* `setServerBasePath` methods that look almost
identical but behave differently — calling the wrong one leaves the asset
handler re-pointed but the WebView still showing the old bundle:

- `CapacitorBridge.setServerBasePath(_ path:)` (the `CAPBridgeProtocol`
  method) **only** updates `config.appLocation` + the `WebViewAssetHandler`'s
  asset path. It does **not** reload the WebView.
- `CAPBridgeViewController.setServerBasePath(path:)` updates the asset path
  **and** reloads the WebView via `webView.load(URLRequest(url: serverURL))`.

`reload()` must call the **view-controller** variant (the same one
Capacitor's own `CAPWebViewPlugin` calls), reached via
`bridge?.viewController as? CAPBridgeViewController`. This was hit during
issue-08 testing: the first implementation called the bridge variant and the
app stayed on build 1 even though `state.current` was 4 and the status line
read "reloading…".
