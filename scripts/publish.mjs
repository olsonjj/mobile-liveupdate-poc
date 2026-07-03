#!/usr/bin/env node
// Manual publish workflow for the live-updates POC (PRD user story 9).
//
//   1. Bump `packages/app/src/version.ts` (VERSION + GREETING) by hand first.
//   2. Run this script: `pnpm publish:payload` (or `node scripts/publish.mjs`).
//
// It will:
//   - read the integer VERSION from version.ts,
//   - build the Angular app (`pnpm --filter app build`),
//   - zip `packages/app/www/` into `packages/server/payloads/build-<v>.zip`
//     with `index.html` at the zip root (the layout the native unzipper
//     validates against),
//   - rewrite `packages/server/manifest.json` to point at the new zip.
//
// The server picks up the rewritten manifest on the next request — no restart
// needed. Plain HTTP localhost, no signing: POC only.

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_SRC = path.join(ROOT, "packages", "app", "src");
const VERSION_TS = path.join(APP_SRC, "version.ts");
const APP_WWW = path.join(ROOT, "packages", "app", "www");
const PAYLOADS_DIR = path.join(ROOT, "packages", "server", "payloads");
const MANIFEST_PATH = path.join(ROOT, "packages", "server", "manifest.json");

function fail(msg) {
  console.error(`publish: ${msg}`);
  process.exit(1);
}

async function readVersion() {
  const src = await readFile(VERSION_TS, "utf8");
  const m = src.match(/export\s+const\s+VERSION[^=]*=\s*(\d+)/);
  if (!m) fail(`could not find VERSION integer in ${VERSION_TS}`);
  return Number(m[1]);
}

async function main() {
  const version = await readVersion();
  const zipName = `build-${version}.zip`;
  const zipPath = path.join(PAYLOADS_DIR, zipName);
  const url = `http://localhost:3000/payloads/${zipName}`;

  console.log(`publish: building app for version ${version}…`);
  execSync("pnpm --filter @ionic-update-poc/app build", { stdio: "inherit", cwd: ROOT });

  if (!existsSync(path.join(APP_WWW, "index.html"))) {
    fail(`expected ${path.join(APP_WWW, "index.html")} after build`);
  }

  await mkdir(PAYLOADS_DIR, { recursive: true });
  if (existsSync(zipPath)) await rm(zipPath, { force: true });

  // Zip from inside www/ so the archive root IS the bundle (index.html at the
  // top level) — the native validator checks for index.html at the bundle root.
  console.log(`publish: zipping ${APP_WWW} → ${zipPath}…`);
  execSync(`zip -r -X "${zipPath}" .`, { stdio: "pipe", cwd: APP_WWW });

  const createdAt = new Date().toISOString();
  const manifest = { version, url, createdAt };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`publish: published version ${version}`);
  console.log(`         url:       ${url}`);
  console.log(`         manifest:  ${MANIFEST_PATH}`);
  console.log(`         createdAt: ${createdAt}`);
}

main().catch((err) => fail(err?.message ?? String(err)));
