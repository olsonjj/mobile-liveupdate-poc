import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import LiveUpdate from './plugin';
import type { CheckResult, DownloadAndStageResult, GetStateResult, RollbackResult, SwapResult } from './types';
import { BUILD } from '../version';
import { environment } from '../../environments/environment';

/**
 * Application-level service that wraps the LiveUpdate Capacitor plugin.
 *
 * Holds reactive state so the UI can bind to current/server version info
 * and update availability without polling.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService implements OnDestroy {
  // ── Reactive state ────────────────────────────────────────────────
  private readonly checkResult = new BehaviorSubject<CheckResult | null>(null);
  private readonly state = new BehaviorSubject<GetStateResult | null>(null);

  /** Observable emitting the latest check result, or null before first check. */
  readonly checkResult$: Observable<CheckResult | null> =
    this.checkResult.asObservable();

  /** Observable emitting the latest state.json contents, or null before loaded. */
  readonly state$: Observable<GetStateResult | null> =
    this.state.asObservable();

  /** Whether an update download/unzip/stage is currently in progress. */
  private readonly isUpdating = new BehaviorSubject<boolean>(false);

  /** Observable emitting whether an update download is in progress (for overlay). */
  readonly isUpdating$: Observable<boolean> =
    this.isUpdating.asObservable();

  /** Server base URL, from environment config. */
  private readonly serverUrl = environment.serverUrl;

  /** Handle for the Capacitor appStateChange listener, removed on destroy. */
  private appStateHandle: PluginListenerHandle | null = null;

  constructor(private readonly ngZone: NgZone) {}

  // ── Public methods ────────────────────────────────────────────────

  /**
   * Called once on cold launch. Initialises the plugin storage (creates
   * directories and state.json if needed), redirects the Capacitor server
   * to the current bundle if one exists from a previous session, and
   * performs a non-blocking version check against the server.
   *
   * The init and check are fire-and-forget: the app shows its current
   * bundle immediately regardless of network latency.
   */
  async initialize(): Promise<void> {
    try {
      await LiveUpdate.initialize();
      const currentState = await LiveUpdate.getState();
      this.ngZone.run(() => this.state.next(currentState));
      // Note: initialize() on the native side already sets the server base
      // path to current/www/ if it exists. The initial page load happens
      // before Angular boots, so a full cold-launch will show the app-bundle
      // assets until the next foreground-check or a new update triggers.
    } catch (err) {
      console.warn('[LiveUpdate] initialize failed (already initialised?):', err);
    }

    // Fire the version check (non-blocking)
    this.performCheck().catch((err) =>
      console.warn('[LiveUpdate] initial check failed:', err),
    );
  }

  /**
   * Begin the update process: show overlay, download zip, unzip,
   * stage, and atomically swap the staged bundle into `current/`.
   * Called automatically when an update is available.
   *
   * On failure at any stage the overlay is dismissed and the active
   * bundle is left untouched. On success the overlay is dismissed
   * (WebView reload comes in issue 08).
   */
  async beginUpdate(zipUrl: string, version: number): Promise<SwapResult> {
    this.ngZone.run(() => this.isUpdating.next(true));

    try {
      // Stage: download + unzip + validate
      const stageResult = await LiveUpdate.downloadAndStageUpdate({
        zipUrl,
        version,
      });

      if (!stageResult.success) {
        this.ngZone.run(() => this.isUpdating.next(false));
        console.warn('[LiveUpdate] Stage failed:', stageResult.error);
        return { success: false, version: null, error: stageResult.error };
      }

      // Swap: move current→previous, staged→current, update state.json
      const swapResult = await this.swapToStagedUpdate(version);

      if (!swapResult.success) {
        this.ngZone.run(() => this.isUpdating.next(false));
        console.warn('[LiveUpdate] Swap failed:', swapResult.error);
        return swapResult;
      }

      // Refresh in-memory state
      await this.refreshState();

      // 8. Reload the WebView from the new bundle (approach 9a)
      console.log('[LiveUpdate] Reloading WebView from new bundle v%d', version);
      await LiveUpdate.reloadWebView();

      // Dismiss overlay after reload triggers (the page navigation will clear it visually)
      this.ngZone.run(() => this.isUpdating.next(false));

      console.log('[LiveUpdate] Update complete for v%d', version);
      return swapResult;
    } catch (err) {
      this.ngZone.run(() => this.isUpdating.next(false));
      console.warn('[LiveUpdate] beginUpdate threw:', err);
      return { success: false, version: null, error: String(err) };
    }
  }

  /**
   * Atomically swap the staged bundle into `current/` and update state.json.
   */
  async swapToStagedUpdate(version: number): Promise<SwapResult> {
    return LiveUpdate.swapToStagedUpdate({ version, bundledBuildNumber: BUILD.number });
  }

  /**
   * Roll back to the previous bundle. Swaps `previous/` into `current/`
   * on the native side, updates state.json, and reloads the WebView.
   *
   * Shows the updating overlay during the operation. On failure the
   * overlay is dismissed and the active bundle is left untouched.
   */
  async rollback(): Promise<RollbackResult> {
    this.ngZone.run(() => this.isUpdating.next(true));

    try {
      const result = await LiveUpdate.rollback();

      if (result.success) {
        await this.refreshState();
        console.log('[LiveUpdate] Rolled back to v%d', result.version);
      } else {
        this.ngZone.run(() => this.isUpdating.next(false));
        console.warn('[LiveUpdate] Rollback failed:', result.error);
      }

      return result;
    } catch (err) {
      this.ngZone.run(() => this.isUpdating.next(false));
      console.warn('[LiveUpdate] rollback threw:', err);
      return { success: false, version: null, error: String(err) };
    }
  }

  /**
   * Dismiss the updating overlay. Called after a successful swap or
   * rollback (issues 07 / 09).
   */
  dismissOverlay(): void {
    this.ngZone.run(() => this.isUpdating.next(false));
  }

  /**
   * Check for an available update.
   */
  async performCheck(): Promise<CheckResult> {
    const result = await LiveUpdate.checkForUpdate({
      serverUrl: this.serverUrl,
      bundledBuildNumber: BUILD.number,
    });

    this.ngZone.run(() => {
      this.checkResult.next(result);
    });

    return result;
  }

  /**
   * Reload the current plugin state from disk.
   */
  async refreshState(): Promise<GetStateResult> {
    const s = await LiveUpdate.getState();
    this.ngZone.run(() => this.state.next(s));
    return s;
  }

  // ── Foreground resume listener ─────────────────────────────────────

  /**
   * Register a Capacitor appStateChange listener so that the version
   * check fires every time the app returns to the foreground (resume).
   *
   * The check is non-blocking and silent — no overlay, no download.
   * If an update is available the UI reactively shows the indicator
   * via the checkResult$ observable.
   */
  async startForegroundListener(): Promise<void> {
    // Remove any previous listener to avoid duplicates
    if (this.appStateHandle) {
      await this.appStateHandle.remove();
    }

    this.appStateHandle = await App.addListener('appStateChange', (state) => {
      if (state.isActive) {
        // App has returned to the foreground — run a silent version check
        this.performCheck().catch((err) =>
          console.warn('[LiveUpdate] foreground check failed:', err),
        );
      }
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async ngOnDestroy(): Promise<void> {
    if (this.appStateHandle) {
      await this.appStateHandle.remove();
      this.appStateHandle = null;
    }
  }

  /** Snapshot of the latest check result (null if never checked). */
  get currentCheckResult(): CheckResult | null {
    return this.checkResult.getValue();
  }

  /** Snapshot of the latest state (null if never loaded). */
  get currentState(): GetStateResult | null {
    return this.state.getValue();
  }
}