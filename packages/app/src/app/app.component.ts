import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonApp,
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
  imports: [FormsModule, IonApp, IonButton, IonContent, IonHeader, IonTitle, IonToolbar],
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
export class AppComponent implements OnInit {
  /** Current build number, read from the bundled version constant. */
  readonly version = VERSION;
  /** Greeting string, read from the bundled version constant. */
  readonly greeting = GREETING;

  /**
   * Live-update status line surfaced from the plugin (issue 04): the cold-launch
   * version check resolves here, non-blocking. Empty until the check produces a
   * result or error.
   */
  readonly status = signal('');

  /**
   * Whether a previous bundle exists to roll back to. Driven by `state.json`
   * (`previous` slot). Still no-op on tap — the rollback action itself arrives
   * in issue 09.
   */
  readonly canRollBack = signal(false);

  async ngOnInit(): Promise<void> {
    // Non-blocking cold-launch check (PRD user story 12 + 14): the UI above is
    // already rendered from the bundled version constant; this promise resolves
    // later and updates the status line + rollback availability via signals.
    this.status.set('Checking for updates…');
    try {
      await LiveUpdate.ensureStorage();
      const state = await LiveUpdate.getState();
      this.canRollBack.set(state.previous !== null);
      const result = await LiveUpdate.checkForUpdate({
        serverUrl: LIVE_UPDATE_SERVER_URL,
        baselineVersion: VERSION,
      });
      this.status.set(
        `current: ${result.currentVersion}, server: ${result.serverVersion}, ` +
          `update available: ${result.updateAvailable ? 'yes' : 'no'}`,
      );
    } catch (err) {
      this.status.set(`update check failed: ${stringifyError(err)}`);
    }
  }

  onRollBack(): void {
    // Implemented in a later slice (issue 09).
  }
}

/** Best-effort error → string so the status line is always readable. */
function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
