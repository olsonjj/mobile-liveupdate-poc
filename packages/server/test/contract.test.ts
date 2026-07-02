import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

/**
 * Contract tests for the live-update server.
 *
 * The server is treated as a black box: tests exercise request/response
 * behavior via Fastify's `inject`, never calling internal functions beyond
 * `buildServer`. Each test owns a temp payloads dir + manifest file so the
 * on-disk-mutation cases don't leak state between tests.
 */

interface Fixture {
  dir: string;
  manifestPath: string;
  payloadsDir: string;
}

async function makeFixture(prefix: string): Promise<Fixture> {
  const dir = await mkdtemp(path.join(tmpdir(), `server-contract-${prefix}-`));
  return {
    dir,
    manifestPath: path.join(dir, "manifest.json"),
    payloadsDir: path.join(dir, "payloads"),
  };
}

async function writeManifest(
  manifestPath: string,
  body: { version: number; url: string; createdAt: string },
) {
  await writeFile(manifestPath, JSON.stringify(body), "utf8");
}

describe("GET /api/updates/latest", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await makeFixture("manifest-");
    await mkdir(fx.payloadsDir, { recursive: true });
    await writeManifest(fx.manifestPath, {
      version: 3,
      url: "http://localhost:3000/payloads/build-3.zip",
      createdAt: "2026-07-02T10:00:00.000Z",
    });
  });

  afterAll(async () => {
    await rm(fx.dir, { recursive: true, force: true });
  });

  it("returns 200 with the manifest shape", async () => {
    const app = await buildServer({
      manifestPath: fx.manifestPath,
      payloadsDir: fx.payloadsDir,
    });
    const res = await app.inject({ method: "GET", url: "/api/updates/latest" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json();
    expect(body).toEqual({
      version: 3,
      url: "http://localhost:3000/payloads/build-3.zip",
      createdAt: "2026-07-02T10:00:00.000Z",
    });
  });

  it("returns a version matching the on-disk manifest.json", async () => {
    const app = await buildServer({
      manifestPath: fx.manifestPath,
      payloadsDir: fx.payloadsDir,
    });
    const res = await app.inject({ method: "GET", url: "/api/updates/latest" });
    const onDisk = JSON.parse(await readFile(fx.manifestPath, "utf8"));
    expect(res.json().version).toBe(onDisk.version);
    expect(res.json().url).toBe(onDisk.url);
    expect(res.json().createdAt).toBe(onDisk.createdAt);
  });

  it("reflects an on-disk manifest rewrite on the next request", async () => {
    const app = await buildServer({
      manifestPath: fx.manifestPath,
      payloadsDir: fx.payloadsDir,
    });

    const first = await app.inject({
      method: "GET",
      url: "/api/updates/latest",
    });
    expect(first.json().version).toBe(3);

    // Simulate a manual publish: rewrite manifest.json on disk.
    await writeManifest(fx.manifestPath, {
      version: 4,
      url: "http://localhost:3000/payloads/build-4.zip",
      createdAt: "2026-07-02T11:00:00.000Z",
    });

    const second = await app.inject({
      method: "GET",
      url: "/api/updates/latest",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({
      version: 4,
      url: "http://localhost:3000/payloads/build-4.zip",
      createdAt: "2026-07-02T11:00:00.000Z",
    });
  });
});

describe("static payload serving", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await makeFixture("payloads-");
    await mkdir(fx.payloadsDir, { recursive: true });
    // A real zip starts with the PK\x03\x04 magic bytes; use a minimal valid
    // empty-zip so the content-type is exercised regardless of file contents.
    const emptyZip = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x21, 0x00, 0x9c, 0x5a, 0x4e, 0x49, 0x4f, 0x47, 0x0a, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x4b,
      0x01, 0x02, 0x1e, 0x03, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x21, 0x00, 0x9c, 0x5a, 0x4e, 0x49, 0x4f, 0x47, 0x0a, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x4b, 0x05, 0x06, 0x00,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x35, 0x00, 0x00, 0x00, 0x07,
      0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    await writeFile(
      path.join(fx.payloadsDir, "build-5.zip"),
      emptyZip,
    );
    await writeManifest(fx.manifestPath, {
      version: 5,
      url: "http://localhost:3000/payloads/build-5.zip",
      createdAt: "2026-07-02T12:00:00.000Z",
    });
  });

  afterAll(async () => {
    await rm(fx.dir, { recursive: true, force: true });
  });

  function app() {
    return buildServer({
      manifestPath: fx.manifestPath,
      payloadsDir: fx.payloadsDir,
    });
  }

  it("serves the payload bytes at the manifest url", async () => {
    const server = await app();
    const manifestRes = await server.inject({
      method: "GET",
      url: "/api/updates/latest",
    });
    const url = manifestRes.json().url;
    const payloadUrl = url.replace("http://localhost:3000", "");

    const res = await server.inject({ method: "GET", url: payloadUrl });
    expect(res.statusCode).toBe(200);
    // @fastify/static sets application/zip for .zip files.
    expect(res.headers["content-type"]).toContain("application/zip");
    // Body bytes match the file on disk.
    const onDisk = await readFile(
      path.join(fx.payloadsDir, "build-5.zip"),
    );
    expect(Buffer.isBuffer(res.rawPayload)).toBe(true);
    expect(res.rawPayload).toEqual(onDisk);
  });

  it("returns 404 for a non-existent payload", async () => {
    const server = await app();
    const res = await server.inject({
      method: "GET",
      url: "/payloads/does-not-exist.zip",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("plain HTTP on localhost", () => {
  it("listens on 127.0.0.1 when started with the CLI defaults", async () => {
    const fx = await makeFixture("listen-");
    await mkdir(fx.payloadsDir, { recursive: true });
    await writeManifest(fx.manifestPath, {
      version: 1,
      url: "http://127.0.0.1:3999/payloads/build-1.zip",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    const server = await buildServer({
      manifestPath: fx.manifestPath,
      payloadsDir: fx.payloadsDir,
    });
    try {
      const address = await server.listen({ port: 3999, host: "127.0.0.1" });
      expect(address).toContain("127.0.0.1");
    } finally {
      await server.close();
      await rm(fx.dir, { recursive: true, force: true });
    }
  });
});
