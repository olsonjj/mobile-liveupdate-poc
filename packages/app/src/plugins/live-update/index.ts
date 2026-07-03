import { registerPlugin } from '@capacitor/core';

import type { LiveUpdatePlugin } from './definitions';

/**
 * Inlined Capacitor plugin (PRD user story 4): a TypeScript API backed by the
 * native `LiveUpdatePlugin` Swift class under
 * `ios/App/CapApp-SPM/Sources/CapApp-SPM/LiveUpdatePlugin.swift`.
 *
 * Registered under the JS name `"LiveUpdate"`, which matches the Swift class's
 * `jsName`. The bridge auto-discovers the `CAPBridgedPlugin`-conforming class
 * at runtime (Capacitor 8), so no `capacitor.config.ts` entry is required.
 *
 * On non-iOS platforms (e.g. `ng serve`) the proxy throws "not implemented"
 * when a method is invoked — the app guards the cold-launch check so web dev
 * never triggers it.
 */
export const LiveUpdate = registerPlugin<LiveUpdatePlugin>('LiveUpdate');

export type {
  ApplyUpdateOptions,
  CheckForUpdateOptions,
  CheckForUpdateResult,
  LiveUpdatePlugin,
  LiveUpdateState,
  PrepareUpdateOptions,
  PrepareUpdateResult,
  ReloadResult,
} from './definitions';
