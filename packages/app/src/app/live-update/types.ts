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
}