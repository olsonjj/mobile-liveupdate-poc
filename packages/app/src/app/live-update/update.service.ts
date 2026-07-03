import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import LiveUpdate from './plugin';
import type { CheckResult, GetStateResult } from './types';
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

  /** Server base URL, from environment config. */
  private readonly serverUrl = environment.serverUrl;

  /** Handle for the Capacitor appStateChange listener, removed on destroy. */
  private appStateHandle: PluginListenerHandle | null = null;

  constructor(private readonly ngZone: NgZone) {}

  // ── Public methods ────────────────────────────────────────────────

  /**
   * Called once on cold launch. Initialises the plugin storage (creates
   * directories and state.json if needed) and performs a non-blocking
   * version check against the server.
   *
   * Both the init and the check are fire-and-forget: the app shows its
   * current bundle immediately regardless of network latency.
   */
  async initialize(): Promise<void> {
    try {
      await LiveUpdate.initialize();
      const currentState = await LiveUpdate.getState();
      this.ngZone.run(() => this.state.next(currentState));
    } catch (err) {
      console.warn('[LiveUpdate] initialize failed (already initialised?):', err);
    }

    // Fire the version check (non-blocking)
    this.performCheck().catch((err) =>
      console.warn('[LiveUpdate] initial check failed:', err),
    );
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