# App: Hello World UI with build number + greeting on iOS sim

## What to build

Scaffold the Ionic + Angular 22 + Capacitor (latest) app in `packages/app`. Add the iOS platform only (no Android). The app loads its web assets from the app bundle (no live-update plugin yet — that comes in later slices).

Create a `version.ts` constant exposing the current build number (an integer) and a greeting string. The app UI renders:

- The build number (read from `version.ts`)
- The greeting string (read from `version.ts`)
- A "Roll Back" button, rendered but disabled (it has nothing to roll back to yet)

This slice establishes the base app that subsequent update slices will mutate.

## Acceptance criteria

- [ ] `packages/app` is a working Ionic + Angular 22 + Capacitor project
- [ ] iOS platform is added; no Android platform present
- [ ] A `version.ts` constant exposes an integer build number and a greeting string
- [ ] The UI displays the build number and the greeting
- [ ] The UI displays a "Roll Back" button, disabled
- [ ] `npx cap sync ios` succeeds
- [ ] The app launches in the iOS simulator and visibly shows "Build: 1 / Hello World" (or equivalent initial values)

## Blocked by

- Issue 01 (Prefactor: monorepo scaffolding)
