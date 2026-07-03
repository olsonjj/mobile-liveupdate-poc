/**
 * On-device live-update state, mirroring `state.json` (see `PRD.md` →
 * "On-device storage layout"). `null` means "no bundle in this slot yet".
 */
export interface LiveUpdateState {
  current: number | null;
  previous: number | null;
}

/** Options for {@link LiveUpdatePlugin.checkForUpdate}. */
export interface CheckForUpdateOptions {
  /**
   * Absolute URL of `GET /api/updates/latest` on the Fastify server, e.g.
   * `http://localhost:3000/api/updates/latest`.
   */
  serverUrl: string;
  /**
   * The app-bundle build number (from `version.ts`), used as the local
   * baseline for comparison when `state.current` is null — i.e. before any
   * update has been applied. Once an update lands, `state.current` takes over.
   */
  baselineVersion: number;
}

/** Result of {@link LiveUpdatePlugin.checkForUpdate}. */
export interface CheckForUpdateResult {
  /** The locally recorded current version (or the baseline on first run). */
  currentVersion: number;
  /** The server's published build number. */
  serverVersion: number;
  /** `true` iff `serverVersion > currentVersion`. */
  updateAvailable: boolean;
  /**
   * The payload zip URL from the manifest, forwarded so the JS layer can hand
   * it straight to {@link LiveUpdatePlugin.prepareUpdate} without re-fetching
   * the manifest. Empty string when the manifest lacked a `url`.
   */
  url: string;
}

/** Options for {@link LiveUpdatePlugin.prepareUpdate}. */
export interface PrepareUpdateOptions {
  /**
   * Absolute URL of the payload zip to download — the `url` field of the
   * server manifest (see {@link CheckForUpdateResult.url}).
   */
  url: string;
}

/** Result of {@link LiveUpdatePlugin.prepareUpdate}. */
export interface PrepareUpdateResult {
  /**
   * Absolute on-device path to the staged bundle directory
   * (`…/liveupdates/staging/www/`), for debugging via
   * `xcrun simctl get_app_container`.
   */
  stagingPath: string;
}

/** Options for {@link LiveUpdatePlugin.applyUpdate}. */
export interface ApplyUpdateOptions {
  /**
   * The build number being promoted to active — the `serverVersion` that
   * {@link LiveUpdatePlugin.checkForUpdate} returned. Written verbatim into
   * `state.current`; `state.previous` becomes whatever the old current was.
   */
  version: number;
}

/** Result of {@link LiveUpdatePlugin.reload}. */
export interface ReloadResult {
  /**
   * Absolute on-device path the WebView was re-pointed at
   * (`…/liveupdates/current/www/`), for debugging via
   * `xcrun simctl get_app_container`.
   */
  path: string;
}

/**
 * TypeScript contract for the inlined native `LiveUpdatePlugin` Swift class
 * (see `packages/app/live-update-plugin/ios/Sources/LiveUpdatePlugin/LiveUpdatePlugin.swift`).
 *
 * Slices implemented so far:
 *   - issue 04: on-device state (`ensureStorage`, `getState`) + version check
 *     (`checkForUpdate`).
 *   - issue 06: `prepareUpdate` — download/unzip/validate-to-staging with an
 *     "Updating…" overlay. The atomic swap's directory moves are issue 07; the
 *     WebView reload is issue 08; rollback is issue 09.
 *   - issue 07: `applyUpdate` — atomically swap the staged bundle into
 *     `current/`, rotate the old current into `previous/`, and update
 *     `state.json`. Dismisses the overlay on completion (success or failure).
 *     Does NOT reload the WebView — that is issue 08.
 *   - issue 08 (this slice): `reload` — re-point the Capacitor WebView at the
 *     writable active bundle (`current/www/index.html`) via
 *     `CAPBridgeProtocol.setServerBasePath(_:)` (PRD approach 9a). The bridge
 *     re-serves `index.html` + all assets from the new path and the WebView
 *     reloads, so the user sees the updated build number + greeting. No
 *     `CAPBridge` subclassing required. Reused by the rollback flow (issue 09).
 */
export interface LiveUpdatePlugin {
  /** Ensure the storage layout + initial `state.json` exist. */
  ensureStorage(): Promise<{ root: string }>;
  /** Read `state.json`. */
  getState(): Promise<LiveUpdateState>;
  /** Fetch the manifest and compare versions. Non-blocking. */
  checkForUpdate(options: CheckForUpdateOptions): Promise<CheckForUpdateResult>;
  /**
   * Download + unzip + validate a payload zip into `staging/www/`, showing an
   * "Updating…" overlay over the WebView. Does NOT swap or reload. On failure
   * the overlay is dismissed and nothing is mutated. On success the overlay
   * stays visible (handed off to {@link LiveUpdatePlugin.applyUpdate}).
   */
  prepareUpdate(options: PrepareUpdateOptions): Promise<PrepareUpdateResult>;
  /**
   * Atomically promote the staged bundle into `current/`, rotate the old
   * current into `previous/`, and write `state.json`. Dismisses the
   * "Updating…" overlay on completion (success or failure). Does NOT reload
   * the WebView — the app still shows the old version on screen after a
   * successful swap; the reload arrives in issue 08. On any failure the
   * active bundle pointer is left unchanged.
   */
  applyUpdate(options: ApplyUpdateOptions): Promise<LiveUpdateState>;
  /**
   * Re-point the Capacitor WebView at the active bundle at
   * `current/www/index.html` and reload it (PRD approach 9a, issue 08).
   * Implemented via `CAPBridgeProtocol.setServerBasePath(_:)`, which updates
   * the bridge's `WebViewAssetHandler` asset path and reloads the WebView to
   * its local URL so `index.html` + all assets are served from the writable
   * `current/www/` directory. Validates `index.html` exists first; on failure
   * rejects and leaves the WebView on its current bundle. The active bundle
   * pointer in `state.json` is never changed here. Reused by rollback (09).
   */
  reload(): Promise<ReloadResult>;
}
