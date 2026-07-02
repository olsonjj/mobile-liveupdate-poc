import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Contract tests should not leak watch mode state; run then exit.
    pool: "threads",
  },
});
