/** Shape of the on-device state.json file. */
export interface LiveUpdateState {
  current: number | null;
  previous: number | null;
}

/** Shape of the server manifest returned by GET /api/updates/latest. */
export interface Manifest {
  version: number;
  url: string;
  createdAt: string;
}

/** Result of a check-for-update call. */
export interface CheckResult {
  /** The build number recorded in state.json (null on first launch). */
  localVersion: number | null;
  /** The build number served by the server (null if fetch failed). */
  serverVersion: number | null;
  /** True when serverVersion > localVersion. */
  updateAvailable: boolean;
  /** The URL of the zip payload from the manifest (set when update is available). */
  zipUrl: string | null;
}

/** Result of getState(). */
export interface GetStateResult {
  current: number | null;
  previous: number | null;
}

/** Result of a download-and-stage call. */
export interface DownloadAndStageResult {
  /** True if the download, unzip, and validation succeeded. */
  success: boolean;
  /** The version number of the staged bundle (only on success). */
  version: number | null;
  /** Human-readable error message (only on failure). */
  error: string | null;
}

/** Result of a swap-to-staged call. */
export interface SwapResult {
  /** True if the atomic swap and state update succeeded. */
  success: boolean;
  /** The version number that was swapped in (only on success). */
  version: number | null;
  /** Human-readable error message (only on failure). */
  error: string | null;
}

/** Result of a rollback call. */
export interface RollbackResult {
  /** True if the rollback succeeded. */
  success: boolean;
  /** The version number rolled back to (only on success). */
  version: number | null;
  /** Human-readable error message (only on failure). */
  error: string | null;
}

/** Result of a reloadWebView call. */
export interface ReloadResult {
  /** True if the WebView was reloaded from the current bundle. */
  reloaded: boolean;
}

/** Interface exposed by the LiveUpdate Capacitor plugin. */
export interface LiveUpdatePluginPlugin {
  /**
   * Ensure the storage layout exists under
   * Library/Application Support/liveupdates/ with current/, previous/
   * subdirectories and an initialised state.json.
   *
   * Called once on cold launch before any other plugin methods.
   */
  initialize(): Promise<void>;

  /**
   * Return the contents of state.json.
   */
  getState(): Promise<GetStateResult>;

  /**
   * Fetch GET /api/updates/latest from the server, compare
   * server.version against the locally-recorded current version,
   * and return whether an update is available.
   *
   * When state.current is null (first launch), the packaged
   * build number is used as the local baseline.
   *
   * @param serverUrl  Base URL of the update server (e.g. http://localhost:3000)
   * @param bundledBuildNumber  The build number baked into the app bundle (from version.ts)
   */
  checkForUpdate(options: {
    serverUrl: string;
    bundledBuildNumber: number;
  }): Promise<CheckResult>;

  /**
   * Download a payload zip from the given URL, unzip it into a staging
   * directory under Library/Application Support/liveupdates/staging/,
   * and validate that the unzipped bundle contains an index.html at its
   * root.
   *
   * On failure the staging directory and any temporary files are cleaned
   * up and the active bundle is left completely untouched.
   *
   * @param zipUrl  Full URL to the payload zip (from the server manifest)
   * @param version  The version number of the payload (for staging dir naming)
   */
  downloadAndStageUpdate(options: {
    zipUrl: string;
    version: number;
  }): Promise<DownloadAndStageResult>;

  /**
   * Atomically swap the staged bundle into `current/`, moving the old
   * `current/` to `previous/`, and update state.json.
   *
   * On failure the prior directory arrangement is restored and the
   * active pointer (state.json) is left unchanged.
   *
   * @param version  The version number being swapped in
   */
  swapToStagedUpdate(options: {
    version: number;
    bundledBuildNumber: number;
  }): Promise<SwapResult>;

  /**
   * Reload the Capacitor WebView from the current bundle's index.html
   * (approach 9a). Uses WKWebView.loadFileURL to point the WebView at
   * the writable `current/www/` directory.
   *
   * If no current bundle exists (first launch before any update),
   * resolves with `{ reloaded: false }` — the app is already showing
   * the bundled assets.
   */
  reloadWebView(): Promise<ReloadResult>;

  /**
   * Swap `previous/` into `current/`, update state.json, and reload
   * the WebView from the rolled-back bundle.
   *
   * On failure (no previous bundle, or directory operations fail)
   * returns `{ success: false, version: null, error: "…" }`.
   */
  rollback(): Promise<RollbackResult>;
}