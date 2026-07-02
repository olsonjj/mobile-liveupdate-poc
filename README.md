# Roll-Your-Own Ionic Live Updates POC

A throwaway proof-of-concept for shipping web-asset changes to a Capacitor iOS
app at runtime without going through the App Store — a simpler, self-hosted
alternative to Ionic AppFlow's Live Updates feature.

> ⚠️ **Insecure by design.** This is a POC only: plain HTTP, no payload signing,
> no integrity verification beyond an `index.html` presence check. **Do not ship
> this code to real users.** See the limitations section below and `PRD.md`.

## Status

Currently this repository is **scaffolding only** — a pnpm-workspaces monorepo
with empty placeholder packages. App and server logic will be filled in by
subsequent slices. See `issues/` for the implementation plan and `PRD.md` for the
full product requirements.

## Monorepo layout

```
.
├── PRD.md
├── README.md
├── package.json          # root (private), pnpm workspace tooling + dev scripts
├── pnpm-workspace.yaml   # declares packages/*
├── issues/               # slice-by-slice implementation plan
└── packages/
    ├── app/              # Ionic + Angular 22 + Capacitor (iOS only)
    └── server/          # Fastify + TypeScript manifest/payload server
```

### The live-update plugin is inlined into the app package

Per an explicit decision in `PRD.md` (user story 4), the Capacitor live-update
plugin is **not** a standalone workspace package. It lives as a subfolder inside
`packages/app` — its TypeScript API alongside the Angular source and its native
Swift code under the iOS project. This avoids the packaging overhead of a
standalone plugin package for a throwaway POC while keeping the two workspace
concerns (app vs. server) clearly separated.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10
- Xcode (for the iOS simulator; added in a later slice)

## Getting started

```sh
pnpm install
```

Root convenience scripts orchestrate the workspaces:

```sh
pnpm dev:server   # start the Fastify server (later slice)
pnpm dev:app      # run the Ionic app (later slice)
pnpm build        # build all workspaces
pnpm test         # run tests across all workspaces
```

## Definition of done (POC)

Open the app in the iOS simulator showing "Build: N / Hello World"; publish
build N+1 on the server; bring the app to the foreground; observe the
"Updating…" overlay, the download/swap, and the reload showing
"Build: N+1 / Hello World v2"; tap "Roll Back" and observe the app reload
showing "Build: N" again. A failed update (e.g. a corrupt zip) must leave
build N running.

See `PRD.md` for the full problem statement, solution, user stories, and
implementation decisions.
