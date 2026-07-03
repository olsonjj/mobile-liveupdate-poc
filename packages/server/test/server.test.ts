import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../src/server.js";
import type { Manifest } from "../src/types.js";

describe("server HTTP contract", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/updates/latest", () => {
    it("returns 200 with a body matching { version, url, createdAt }", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/updates/latest",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);

      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("version");
      expect(typeof body.version).toBe("number");
      expect(body).toHaveProperty("url");
      expect(typeof body.url).toBe("string");
      expect(body).toHaveProperty("createdAt");
      expect(typeof body.createdAt).toBe("string");
    });

    it("returns the version recorded in the on-disk manifest.json", async () => {
      const manifestPath = resolve(import.meta.dirname, "..", "manifest.json");
      const diskManifest = JSON.parse(
        readFileSync(manifestPath, "utf-8"),
      ) as Manifest;

      const res = await app.inject({
        method: "GET",
        url: "/api/updates/latest",
      });

      const body = JSON.parse(res.body) as Manifest;
      expect(body.version).toBe(diskManifest.version);
      expect(body.url).toBe(diskManifest.url);
      expect(body.createdAt).toBe(diskManifest.createdAt);
    });

    it("reflects manifest.json rewrites on the next request (simulated publish)", async () => {
      const manifestPath = resolve(import.meta.dirname, "..", "manifest.json");
      const original = readFileSync(manifestPath, "utf-8");
      const originalManifest = JSON.parse(original) as Manifest;

      const updated: Manifest = {
        version: originalManifest.version + 1,
        url: "http://localhost:3000/api/payloads/build-2.zip",
        createdAt: new Date().toISOString(),
      };

      try {
        writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + "\n");

        const res = await app.inject({
          method: "GET",
          url: "/api/updates/latest",
        });

        const body = JSON.parse(res.body) as Manifest;
        expect(body.version).toBe(originalManifest.version + 1);
        expect(body.url).toBe("http://localhost:3000/api/payloads/build-2.zip");
      } finally {
        // Restore original manifest
        writeFileSync(manifestPath, original);
      }
    });
  });

  describe("static payload serving", () => {
    it("serves zip files listed in the manifest with correct content type", async () => {
      const manifestRes = await app.inject({
        method: "GET",
        url: "/api/updates/latest",
      });
      const manifest = JSON.parse(manifestRes.body) as Manifest;

      // Extract path from the URL
      const urlPath = new URL(manifest.url).pathname;

      const res = await app.inject({
        method: "GET",
        url: urlPath,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/zip|octet-stream/);
      expect(Number(res.headers["content-length"])).toBeGreaterThan(0);
    });

    it("returns 404 for a non-existent payload", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/payloads/non-existent.zip",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});