import { buildServer, defaultServerOptions } from "./server.js";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";

const options = defaultServerOptions();
const app = await buildServer(options);

try {
  await app.listen({ port, host });
  console.log(
    `[server] live-update server listening on http://${host}:${port}`,
  );
  console.log(`[server] manifest: ${options.manifestPath}`);
  console.log(`[server] payloads: ${options.payloadsDir}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
