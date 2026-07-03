import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { readManifest } from "./manifest.js";
import type { Manifest } from "./types.js";

export function buildApp() {
  const app = Fastify({ logger: false });

  // Register static file serving for payloads
  const payloadsDir = resolve(import.meta.dirname, "..", "payloads");
  app.register(fastifyStatic, {
    root: payloadsDir,
    prefix: "/api/payloads/",
    decorateReply: false,
  });

  // GET /api/updates/latest — returns the current manifest
  app.get<{ Reply: Manifest }>("/api/updates/latest", async (_request, reply) => {
    const manifest = readManifest();
    return reply.send(manifest);
  });

  return app;
}