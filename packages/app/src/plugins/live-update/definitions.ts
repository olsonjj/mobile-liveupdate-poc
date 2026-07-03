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

/**
 * TypeScript contract for the inlined native `LiveUpdatePlugin` Swift class
 * (see `packages/app/live-update-plugin/ios/Sources/LiveUpdatePlugin/LiveUpdatePlugin.swift`).
 *
 * Slices implemented so far:
 *   - issue 04: on-device state (`ensureStorage`, `getState`) + version check
 *     (`checkForUpdate`).
 *   - issue 06: `prepareUpdate` — download/unzip/validate-to-staging with an
 *     "Updating…" overlay. The atomic swap, WebView reload, and rollback
 *     arrive in later issues.
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
   * "Updating…" overlay over the WebView. Does NOT swap or reload — those are
   * later slices. On failure the overlay is dismissed and nothing is mutated.
   * On success the overlay stays visible (handed off to the swap slice).
   */
  prepareUpdate(options: PrepareUpdateOptions): Promise<PrepareUpdateResult>;
}
