import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The shape of the on-disk `manifest.json` and of the `GET /api/updates/latest`
 * response body. Documented in `PRD.md` ("Update manifest contract").
 */
export interface Manifest {
  /** Monotonically increasing integer build number. */
  version: number;
  /** Absolute or host-relative URL to the payload zip. */
  url: string;
  /** ISO 8601 timestamp marking when this version was published. */
  createdAt: string;
}

/**
 * Read and parse the manifest JSON file from disk.
 *
 * The current version is stored on disk so the manual publish workflow (a later
 * slice) only needs to rewrite this file; the next request picks up the change.
 * Throws on missing file or invalid JSON so the HTTP layer can surface a 500.
 */
export async function readManifest(manifestPath: string): Promise<Manifest> {
  const raw = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return validateManifest(parsed);
}

/** Narrow an unknown parsed value to a well-formed {@link Manifest}. */
export function validateManifest(value: unknown): Manifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("manifest must be a JSON object");
  }
  const { version, url, createdAt } = value as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error("manifest.version must be an integer");
  }
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("manifest.url must be a non-empty string");
  }
  if (typeof createdAt !== "string" || createdAt.length === 0) {
    throw new Error("manifest.createdAt must be a non-empty string");
  }
  return { version, url, createdAt };
}

/** Resolve a manifest `url` to the path it serves within the payloads dir. */
export function payloadPathFromUrl(url: string, payloadsDir: string): string {
  const parsed = new URL(url, "http://localhost");
  const pathname = parsed.pathname;
  const filename = path.basename(pathname);
  if (!filename) {
    throw new Error(`manifest.url does not reference a payload file: ${url}`);
  }
  // Only the basename is trusted; the rest of the URL is ignored so a manifest
  // cannot escape the payloads directory via path traversal.
  return path.join(payloadsDir, filename);
}
