import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonApp,
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

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
        <ion-button (click)="onRollBack()" [disabled]="!canRollBack">
          Roll Back
        </ion-button>
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
    `,
  ],
})
export class AppComponent {
  /** Current build number, read from the bundled version constant. */
  readonly version = VERSION;
  /** Greeting string, read from the bundled version constant. */
  readonly greeting = GREETING;

  /**
   * No previous bundle exists yet — the rollback button stays disabled.
   * Later slices wire this to the live-update plugin's state.
   */
  readonly canRollBack = false;

  onRollBack(): void {
    // No-op for now; implemented in a later slice.
  }
}
