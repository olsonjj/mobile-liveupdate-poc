# Prefactor: monorepo scaffolding

## What to build

Set up the pnpm workspaces monorepo at the project root. Create a root `package.json` (private, with pnpm workspace configuration), a `pnpm-workspace.yaml` declaring `packages/*`, and two empty workspace package directories: `packages/app` and `packages/server`. Add root-level npm scripts as convenient for dev orchestration. Initialize git and add a top-level README noting the intended layout (app + server packages, with the live-update plugin inlined into the app package — not a separate workspace package).

No app or server logic is built in this slice — it is pure scaffolding so that subsequent slices have a home.

## Acceptance criteria

- [ ] Root `package.json` exists, marked private, with pnpm workspace tooling configured
- [ ] `pnpm-workspace.yaml` exists and declares `packages/*`
- [ ] `packages/app/` and `packages/server/` directories exist (each may have a placeholder `package.json`)
- [ ] Git repository initialized at the project root
- [ ] README at the root documents the monorepo layout and the decision that the plugin lives inlined under the app package
- [ ] `pnpm install` runs cleanly from the root with no errors

## Blocked by

None - can start immediately
