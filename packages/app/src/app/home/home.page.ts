import { Component } from '@angular/core';
import { BUILD } from '../version';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  /** Build number from the currently bundled version constant. */
  readonly buildNumber: number = BUILD.number;

  /** Greeting from the currently bundled version constant. */
  readonly greeting: string = BUILD.greeting;

  /**
   * Whether a previous bundle exists to roll back to.
   * Always false at this stage — the live-update plugin will wire this up later.
   */
  hasPrevious = false;

  constructor() {}

  /**
   * Placeholder for rollback. Will be wired to the live-update plugin in a later slice.
   */
  rollBack(): void {
    // no-op until the live-update plugin is integrated
  }
}