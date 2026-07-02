import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { readManifest, type Manifest } from "./manifest.js";

export interface ServerOptions {
  /** Absolute path to the on-disk `manifest.json`. */
  manifestPath: string;
  /** Absolute path to the directory holding payload zips. */
  payloadsDir: string;
}

/**
 * Build (but do not listen on) a Fastify instance.
 *
 * Exposed as a function rather than a side-effectful module so contract tests
 * can `inject` requests against the server as a black box without binding a
 * port. The CLI entrypoint (`index.ts`) calls `listen` on the result.
 */
export async function buildServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: options.payloadsDir,
    prefix: "/payloads/",
    decorateReply: true,
  });

  app.get("/api/updates/latest", async (_req, reply) => {
    let manifest: Manifest;
    try {
      manifest = await readManifest(options.manifestPath);
    } catch (err) {
      app.log.error(
        { err, manifestPath: options.manifestPath },
        "failed to read manifest",
      );
      return reply
        .code(500)
        .type("application/json")
        .send({ error: "manifest-unavailable" });
    }
    return reply.code(200).type("application/json").send(manifest);
  });

  return app;
}

/** Convenience for the CLI entrypoint. */
export function defaultServerOptions(): ServerOptions {
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  return {
    manifestPath: path.join(root, "manifest.json"),
    payloadsDir: path.join(root, "payloads"),
  };
}
