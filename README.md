# Roll-Your-Own Ionic Live Updates POC

A throwaway proof-of-concept for shipping web-asset changes to a Capacitor iOS
app at runtime without going through the App Store — a simpler, self-hosted
alternative to Ionic AppFlow's Live Updates feature.

> ⚠️ **Insecure by design.** This is a POC only: plain HTTP, no payload signing,
> no integrity verification beyond an `index.html` presence check. **Do not ship
> this code to real users.** See the limitations section below and `PRD.md`.

## WebView reload approach (decision 9a)

The POC uses **approach 9a**: after a successful swap, Capacitor's
`setServerBasePath(path:)` API redirects where the internal web server serves
assets from, then `webView.reload()` triggers a full page reload. This is the
same mechanism Ionic AppFlow uses for live updates.

**Why `setServerBasePath` instead of `loadFileURL`:**

- `WKWebView.loadFileURL(_:allowingReadAccessTo:)` was attempted first but
  failed. Capacitor's `WKNavigationDelegate` intercepts `file://` navigations
  and attempts to open them externally (in Safari), causing a sandbox/security
  error (`FBSOpenApplicationServiceErrorDomain`).
- `setServerBasePath` avoids this entirely: requests stay within the
  `capacitor://` scheme, Capacitor's internal server handles them, and the
  bridge reinitialization is seamless. This is Capacitor's sanctioned API for
  changing the asset root at runtime.

**Why 9a instead of 9b (runtime module swap):**

- 9a is cleaner: the entire web bundle is swapped and the WebView does a full
  reload, so `index.html`, all JS bundles, and all assets come from the updated
  directory.
- 9b is uglier: it keeps the app-bundle shell and dynamically imports JS from
  the writable directory. It does not update `index.html` cleanly and increases
  complexity in the Angular entrypoint.

## Status

Core update flow implemented: the app checks for updates on launch and foreground,
downloads new web bundles, atomically swaps them, and reloads the WebView.
Rollback is wired up via the UI button. See `PRD.md` for the full product
requirements and `issues/` for the implementation plan.

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
