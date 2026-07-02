# App: proper Angular 22 build cleanup (esbuild-only, drop dead deps)

## What to build

The Part 3 scaffold works but carries two leftovers from a stock Angular
scaffold that produce deprecation warnings on install and add dead weight:

1. `@angular/platform-browser-dynamic` is installed but never imported —
   `main.ts` bootstraps from `@angular/platform-browser` (the JIT/`platform-browser-dynamic`
   path is unused in a standalone+AOT app). Angular 22 marks it deprecated.
2. `@angular-devkit/build-angular` is the legacy meta-package that pulls in the
   webpack-based builders (`@ngtools/webpack`, `:browser`) *alongside* the
   esbuild `:application` builder we actually use. Angular 22 ships a leaner
   `@angular/build` package that provides the esbuild `:application` builder
   with no webpack baggage.

Switch to the lean, esbuild-only path so `pnpm install` is warning-free and
the dependency surface matches what the build actually uses.

## Acceptance criteria

- [x] `@angular/platform-browser-dynamic` removed from `packages/app/package.json`
- [x] `@angular-devkit/build-angular` replaced with `@angular/build` in `packages/app/package.json`
- [x] `angular.json` builders updated to `@angular/build:application` / `@angular/build:dev-server`
- [x] `pnpm install` produces no deprecation warnings related to `@ngtools/webpack` or `platform-browser-dynamic`
- [x] `pnpm --filter @ionic-update-poc/app build` succeeds
- [x] `npx cap sync ios` succeeds
- [x] App still launches in the iOS simulator and renders "Build: 1 / Hello World"

## Blocked by

- Issue 03 (App: Hello World UI with build number + greeting on iOS sim)
