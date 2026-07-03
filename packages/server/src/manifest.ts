import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "./types.js";

const MANIFEST_PATH = resolve(import.meta.dirname, "..", "manifest.json");

export function readManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Manifest;
}