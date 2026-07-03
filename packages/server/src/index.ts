import { buildApp } from "./server.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Server running at http://localhost:${PORT}`);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();