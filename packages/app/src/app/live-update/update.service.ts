import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import LiveUpdate from './plugin';
import type { CheckResult, GetStateResult } from './types';
import { BUILD } from '../version';

/**
 * Application-level service that wraps the LiveUpdate Capacitor plugin.
 *
 * Holds reactive state so the UI can bind to current/server version info
 * and update availability without polling.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  // ── Reactive state ────────────────────────────────────────────────
  private readonly checkResult = new BehaviorSubject<CheckResult | null>(null);
  private readonly state = new BehaviorSubject<GetStateResult | null>(null);

  /** Observable emitting the latest check result, or null before first check. */
  readonly checkResult$: Observable<CheckResult | null> =
    this.checkResult.asObservable();

  /** Observable emitting the latest state.json contents, or null before loaded. */
  readonly state$: Observable<GetStateResult | null> =
    this.state.asObservable();

  /** Server base URL — kept in one place for easy reconfiguration. */
  private readonly serverUrl = 'http://localhost:3000';

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

  /** Snapshot of the latest check result (null if never checked). */
  get currentCheckResult(): CheckResult | null {
    return this.checkResult.getValue();
  }

  /** Snapshot of the latest state (null if never loaded). */
  get currentState(): GetStateResult | null {
    return this.state.getValue();
  }
}