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
}

/**
 * TypeScript contract for the inlined native `LiveUpdatePlugin` Swift class
 * (see `packages/app/ios/App/CapApp-SPM/Sources/CapApp-SPM/LiveUpdatePlugin.swift`).
 *
 * This slice (issue 04) covers on-device state management + the version check
 * only; download/unzip/swap/reload/rollback methods arrive in later issues.
 */
export interface LiveUpdatePlugin {
  /** Ensure the storage layout + initial `state.json` exist. */
  ensureStorage(): Promise<{ root: string }>;
  /** Read `state.json`. */
  getState(): Promise<LiveUpdateState>;
  /** Fetch the manifest and compare versions. Non-blocking. */
  checkForUpdate(options: CheckForUpdateOptions): Promise<CheckForUpdateResult>;
}
