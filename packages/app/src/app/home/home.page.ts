import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { BUILD } from '../version';
import { UpdateService } from '../live-update/update.service';
import type { CheckResult, GetStateResult, SwapResult } from '../live-update/types';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  /** Build number from the currently bundled version constant. */
  readonly buildNumber: number = BUILD.number;

  /** Greeting from the currently bundled version constant. */
  readonly greeting: string = BUILD.greeting;

  /** Whether a previous bundle exists to roll back to. */
  hasPrevious = false;

  // ── Live-update state ────────────────────────────────────────────

  /** The local version recorded in state.json (null until loaded). */
  localVersion: number | null = null;

  /** The server version from the last check (null until checked). */
  serverVersion: number | null = null;

  /** Whether the last check found an available update. */
  updateAvailable = false;

  /** Whether the initial check has completed (for display purposes). */
  checkComplete = false;

  /** Whether an update download/unzip is in progress (shows overlay). */
  isUpdating = false;

  /** Tracking whether the auto-update has already been triggered. */
  private updateInProgress = false;

  private readonly subs: Subscription[] = [];

  constructor(private readonly updateService: UpdateService) {}

  ngOnInit(): void {
    // Subscribe to state changes
    this.subs.push(
      this.updateService.state$.subscribe((state: GetStateResult | null) => {
        this.hasPrevious = state?.previous != null;
      }),
    );

    // Subscribe to check results and auto-trigger update when available
    this.subs.push(
      this.updateService.checkResult$.subscribe(
        (result: CheckResult | null) => {
          if (result) {
            this.localVersion = result.localVersion;
            this.serverVersion = result.serverVersion;
            this.updateAvailable = result.updateAvailable;
            this.checkComplete = true;

            // Auto-trigger download + swap when update is available and not already in progress
            if (
              result.updateAvailable &&
              result.zipUrl &&
              result.serverVersion != null &&
              !this.updateInProgress
            ) {
              this.updateInProgress = true;
              this.updateService
                .beginUpdate(result.zipUrl, result.serverVersion)
                .then((swapResult: SwapResult) => {
                  if (swapResult.success) {
                    console.log('[HomePage] Update swapped successfully for v%d', swapResult.version);
                  }
                  this.updateInProgress = false;
                })
                .catch((err) => {
                  console.warn('[HomePage] beginUpdate failed:', err);
                  this.updateInProgress = false;
                });
            }
          }
        },
      ),
    );
    // Subscribe to updating state for overlay
    this.subs.push(
      this.updateService.isUpdating$.subscribe((updating: boolean) => {
        this.isUpdating = updating;
      }),
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }

  /**
   * Roll back to the previous bundle.
   *
   * Calls the native plugin to swap `previous/` into `current/`, update
   * state.json, and reload the WebView from the rolled-back bundle.
   */
  rollBack(): void {
    if (!this.hasPrevious) {
      return;
    }

    this.updateService.rollback().then((result) => {
      if (!result.success) {
        console.warn('[HomePage] Rollback failed:', result.error);
      }
    }).catch((err) => {
      console.warn('[HomePage] rollback threw:', err);
    });
  }
}