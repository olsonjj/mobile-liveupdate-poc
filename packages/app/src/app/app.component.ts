import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { App as CapacitorApp, AppState } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  IonApp,
  IonBadge,
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { LiveUpdate } from '../plugins/live-update';
import { LIVE_UPDATE_SERVER_URL } from '../live-update-config';
import { GREETING, VERSION } from '../version';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonApp,
    IonBadge,
    IonButton,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-app>
      <ion-header>
        <ion-toolbar>
          <ion-title>Live Updates POC</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <div class="version-line">Build: {{ version }}</div>
        <div class="greeting-line">{{ greeting }}</div>
        <ion-button (click)="onRollBack()" [disabled]="!canRollBack()">
          Roll Back
        </ion-button>
        @if (updateAvailable()) {
          <div class="update-badge">
            <ion-badge color="warning">
              Update available — build {{ serverVersion() }}
            </ion-badge>
          </div>
        }
        @if (status()) {
          <div class="status-line">{{ status() }}</div>
        }
      </ion-content>
    </ion-app>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .version-line {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 0.25rem;
      }
      .greeting-line {
        font-size: 1.25rem;
        margin-bottom: 1.5rem;
      }
      .update-badge {
        margin-top: 1rem;
      }
      .update-badge ion-badge {
        font-size: 0.9rem;
      }
      .status-line {
        margin-top: 1.5rem;
        font-size: 0.95rem;
        color: var(--ion-color-medium, #6b6b6b);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        word-break: break-word;
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  /** Current build number, read from the bundled version constant. */
  readonly version = VERSION;
  /** Greeting string, read from the bundled version constant. */
  readonly greeting = GREETING;

  /**
   * Developer-facing debug status line (issue 04). Populated on cold launch
   * and on each foreground resume check with a short note. Non-blocking: the
   * UI above renders from the bundled version constant first; this resolves
   * later.
   */
  readonly status = signal('');

  /**
   * User-facing "update available" indicator (issue 05). `true` only when the
   * most recent check found `serverVersion > currentVersion`. Driven by both
   * the cold-launch check and the silent foreground-resume check, so bumping
   * the server version and resuming the app surfaces the badge without a
   * download or overlay.
   */
  readonly updateAvailable = signal(false);

  /** Server build number from the most recent check (for the badge label). */
  readonly serverVersion = signal<number | null>(null);

  /**
   * Whether a previous bundle exists to roll back to. Driven by `state.json`
   * (`previous` slot). Still no-op on tap — the rollback action itself arrives
   * in issue 09.
   */
  readonly canRollBack = signal(false);

  /**
   * Re-entrancy guard for {@link prepareUpdate} (issue 06). `true` while a
   * download/unzip/validate cycle is in flight so a rapid foreground→resume
   * can't kick off a second concurrent staging pass over the first.
   */
  private readonly preparing = signal(false);

  /** Handle for the foreground/resume listener (issue 05), cleaned up on destroy. */
  private resumeListener?: { remove: () => Promise<void> };

  async ngOnInit(): Promise<void> {
    // Cold-launch check (PRD user story 12 + 14): non-blocking; the UI is
    // already rendered from the bundled version constant.
    await this.runCheck('cold');

    // Foreground-resume trigger (PRD user story 13 + 14, issue 05): when the
    // app returns to the foreground, re-run the version check silently. The
    // native plugin layer is only present on iOS; on `ng serve` the listener
    // registration is skipped so web dev never hits "not implemented".
    if (Capacitor.isNativePlatform()) {
      try {
        this.resumeListener = await CapacitorApp.addListener(
          'appStateChange',
          (state: AppState) => {
            if (state.isActive) {
              void this.runCheck('resume');
            }
          },
        );
      } catch (err) {
        this.status.set(
          `${this.status()} | resume listener failed: ${stringifyError(err)}`,
        );
      }
    }
  }

  ngOnDestroy(): void {
    void this.resumeListener?.remove();
  }

  onRollBack(): void {
    // Implemented in a later slice (issue 09).
  }

  // MARK: - Download / unzip / validate to staging (issue 06)

  /**
   * Drive the native `prepareUpdate` → `applyUpdate` → `reload` pipeline
   * (issues 06 + 07 + 08). `prepareUpdate` downloads/unzips/validates into
   * `staging/www/` and shows the "Updating…" overlay; `applyUpdate` atomically
   * rotates staging into `current/`, the old current into `previous/`, and
   * writes `state.json`, then dismisses the overlay; `reload` re-points the
   * Capacitor WebView at the newly-active `current/www/` (approach 9a) so the
   * user sees the updated build number + greeting. Non-blocking: the WebView
   * already rendered its current bundle before this runs. Guarded by
   * {@link preparing} so a foreground-resume can't double-trigger over an
   * in-flight cold-launch staging pass.
   *
   * `reload()` tears down the current JS context as the WebView navigates to
   * the new bundle, so nothing after it is reliable — it is called last, and
   * the reloaded bundle's own `ngOnInit` takes over (running a fresh check).
   */
  private async prepareUpdate(url: string, version: number): Promise<void> {
    if (this.preparing()) {
      return;
    }
    this.preparing.set(true);
    try {
      const staged = await LiveUpdate.prepareUpdate({ url });
      // Overlay is still up; hand off to the atomic swap (issue 07).
      this.status.set(
        `staged build ${version} at ${staged.stagingPath} — swapping…`,
      );

      const newState = await LiveUpdate.applyUpdate({ version });
      this.canRollBack.set(newState.previous !== null);
      // The update is no longer "available" — it has been applied; just the
      // reload (issue 08) remains.
      this.updateAvailable.set(false);
      this.status.set(
        `applied build ${newState.current}` +
          (newState.previous !== null
            ? ` (previous: ${newState.previous})`
            : '') +
          ' — reloading…',
      );

      // Issue 08: re-point the WebView at current/www/ and reload. The native
      // plugin dismisses the overlay as part of the swap; the WebView then
      // navigates to the new bundle, tearing down this JS context. There may
      // be a brief flash of the old bundle between overlay-dismiss and the
      // new bundle painting — acceptable for a POC (documented in the issue
      // 08 decision note). Anything after this call may not run.
      try {
        await LiveUpdate.reload();
      } catch (err) {
        // Reload failed (e.g. current/www/index.html missing after a corrupt
        // state). The active pointer is unchanged; surface the error. The
        // user stays on the old bundle, which is the safe failure mode.
        this.status.set(`reload failed: ${stringifyError(err)}`);
      }
    } catch (err) {
      // prepareUpdate/applyUpdate already cleaned up + dismissed the overlay
      // on the native side; just surface the failure. The active bundle is
      // unchanged on any error path.
      this.updateAvailable.set(false);
      this.status.set(`applyUpdate failed: ${stringifyError(err)}`);
    } finally {
      this.preparing.set(false);
    }
  }

  // MARK: - Version check

  /**
   * Run the version check against the server (issue 04 + issue 05).
   *
   * Non-blocking and silent: this only reads `state.json` + fetches the
   * manifest and updates signals — no overlay, no download, no swap (those
   * arrive in later issues). On cold launch it also writes the verbose debug
   * status line; on resume it just refreshes the indicator + a short note.
   */
  private async runCheck(source: 'cold' | 'resume'): Promise<void> {
    if (source === 'cold') {
      this.status.set('Checking for updates…');
    }
    try {
      // ensureStorage/getState are cheap local file ops; safe to await on
      // resume without blocking the WebView's initial paint (which already
      // happened before the resume event fires).
      await LiveUpdate.ensureStorage();
      const state = await LiveUpdate.getState();
      this.canRollBack.set(state.previous !== null);

      // Cold-launch restore (issue 08): if an update has previously been
      // applied (`state.current` is non-null) and the running app-bundle's
      // `VERSION` constant doesn't match it, re-point the WebView at
      // `current/www/` so the app boots into the previously-applied bundle
      // rather than the stale app-bundle baseline. Without this, killing &
      // relaunching the app after an update would silently show the old
      // app-bundle version again. The reloaded bundle's own `ngOnInit` then
      // runs the version check against the server. On resume this is skipped
      // — the running bundle is already the active one.
      if (
        source === 'cold' &&
        state.current !== null &&
        state.current !== VERSION
      ) {
        this.status.set(`restoring applied build ${state.current}…`);
        try {
          await LiveUpdate.reload();
          // The WebView is reloading from current/www/; this JS context is
          // being torn down. The reloaded bundle's ngOnInit takes over, so
          // stop here rather than running a duplicate check.
          return;
        } catch (err) {
          // Restore failed (e.g. current/www/index.html missing after a
          // corrupted state): fall through to a normal check against the
          // app-bundle baseline. Safe failure mode — app stays on its bundle.
          this.status.set(`restore failed: ${stringifyError(err)}`);
        }
      }

      const result = await LiveUpdate.checkForUpdate({
        serverUrl: LIVE_UPDATE_SERVER_URL,
        baselineVersion: VERSION,
      });

      this.serverVersion.set(result.serverVersion);
      this.updateAvailable.set(result.updateAvailable);

      const note =
        `current: ${result.currentVersion}, server: ${result.serverVersion}, ` +
        `update available: ${result.updateAvailable ? 'yes' : 'no'}`;
      this.status.set(source === 'cold' ? note : `[resume] ${note}`);

      // Issue 06: when an update is available, kick off download/unzip/
      // validate-to-staging. The native plugin shows an "Updating…" overlay
      // over the WebView for the duration; on success the overlay stays
      // visible (handed off to the atomic-swap slice, issue 07), on failure
      // it is dismissed and nothing is mutated.
      if (result.updateAvailable) {
        void this.prepareUpdate(result.url, result.serverVersion);
      }
    } catch (err) {
      const msg = `${source} check failed: ${stringifyError(err)}`;
      this.status.set(source === 'cold' ? msg : `[resume] ${msg}`);
      // A failed check must never surface a stale "update available" badge.
      this.updateAvailable.set(false);
    }
  }
}

/** Best-effort error → string so the status line is always readable. */
function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
