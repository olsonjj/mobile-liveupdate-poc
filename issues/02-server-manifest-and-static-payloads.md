# Server: manifest endpoint + static payload serving (with contract tests)

## What to build

Build the Fastify + TypeScript server in `packages/server`. It must serve two things over plain HTTP on localhost:

1. `GET /api/updates/latest` — reads an on-disk `manifest.json` and returns its contents as the response body. The manifest shape:
   ```json
   { "version": <integer>, "url": "<http url to the zip>", "createdAt": "<ISO 8601>" }
   ```
2. Static zip files from a `payloads/` directory, served at the URLs referenced by `manifest.url`.

The current version is stored in the on-disk `manifest.json` so the manual publish workflow (a later slice) only needs to rewrite that file. A request for a non-existent payload must return a `404`.

Include HTTP contract tests using Fastify's `inject` pattern. Treat the server as a black box: tests exercise request/response behavior only, not internal functions.

## Acceptance criteria

- [x] `GET /api/updates/latest` returns `200` with a body matching `{ version: number, url: string, createdAt: string }`
- [x] The returned `version` matches the version recorded in the on-disk `manifest.json`
- [x] Rewriting `manifest.json` on disk (simulating a manual publish) is reflected on the next request to the endpoint
- [x] Static zip files under `payloads/` are served with the correct content type and bytes when requested via the manifest `url`
- [x] Requesting a non-existent payload returns a `404`
- [x] Server runs over plain HTTP on localhost
- [x] Contract tests pass and cover all the above behaviors

## Blocked by

- Issue 01 (Prefactor: monorepo scaffolding)
