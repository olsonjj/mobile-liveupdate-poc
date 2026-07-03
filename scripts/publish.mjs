#!/usr/bin/env node

/**
 * Publish a new live-update payload.
 *
 * Reads the current build number from packages/app/src/app/version.ts,
 * runs the Angular production build, zips the output, copies it into the
 * server's payloads/ directory, and rewrites manifest.json.
 *
 * Usage:
 *   node scripts/publish.mjs
 *
 * Prerequisites:
 *   1. Bump BUILD.number in packages/app/src/app/version.ts
 *   2. Optionally update BUILD.greeting
 *   3. Run this script
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const APP_DIR = resolve(ROOT, "packages", "app");
const SERVER_DIR = resolve(ROOT, "packages", "server");
const WWW_DIR = resolve(APP_DIR, "www");
const PAYLOADS_DIR = resolve(SERVER_DIR, "payloads");
const VERSION_TS = resolve(APP_DIR, "src", "app", "version.ts");
const MANIFEST_JSON = resolve(SERVER_DIR, "manifest.json");

// 1. Read build number from version.ts
const versionSrc = readFileSync(VERSION_TS, "utf-8");
const match = versionSrc.match(/number:\s*(\d+)/);
if (!match) {
  console.error("❌ Could not find BUILD.number in version.ts");
  process.exit(1);
}
const buildNumber = Number.parseInt(match[1], 10);
console.log(`📦 Publishing build ${buildNumber}…`);

// 2. Run Angular production build
console.log("🔨 Building Angular app (production)…");
execSync("pnpm run build:prod", { cwd: APP_DIR, stdio: "inherit" });

// 3. Zip the www/ output (zip -0: store only — required by the Swift unzipper)
const zipName = `build-${buildNumber}.zip`;
const zipPath = resolve(PAYLOADS_DIR, zipName);
console.log(`📦 Zipping www/ → ${zipPath}`);
execSync(`cd "${WWW_DIR}" && zip -0 -r "${zipPath}" .`, { stdio: "inherit" });

// 4. Write manifest.json
const serverUrl = process.env.SERVER_URL || "http://localhost:3000";
const manifest = {
  version: buildNumber,
  url: `${serverUrl}/api/payloads/${zipName}`,
  createdAt: new Date().toISOString(),
};
writeFileSync(MANIFEST_JSON, JSON.stringify(manifest) + "\n", "utf-8");
console.log(`📋 Wrote manifest.json: version=${buildNumber}, url=${manifest.url}`);

console.log(`✅ Build ${buildNumber} published. Restart the server if it's running.`);