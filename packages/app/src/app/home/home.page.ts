import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { BUILD } from '../version';
import { UpdateService } from '../live-update/update.service';
import type { CheckResult, GetStateResult } from '../live-update/types';

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

  private readonly subs: Subscription[] = [];

  constructor(private readonly updateService: UpdateService) {}

  ngOnInit(): void {
    // Subscribe to state changes
    this.subs.push(
      this.updateService.state$.subscribe((state: GetStateResult | null) => {
        this.hasPrevious = state?.previous != null;
      }),
    );

    // Subscribe to check results
    this.subs.push(
      this.updateService.checkResult$.subscribe(
        (result: CheckResult | null) => {
          if (result) {
            this.localVersion = result.localVersion;
            this.serverVersion = result.serverVersion;
            this.updateAvailable = result.updateAvailable;
            this.checkComplete = true;
          }
        },
      ),
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }

  /**
   * Placeholder for rollback. Will be wired to the live-update plugin in a later slice.
   */
  rollBack(): void {
    // no-op until the live-update plugin is integrated
  }
}