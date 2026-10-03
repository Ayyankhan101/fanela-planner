import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
    // one shared PG database + fixtures imported/deleted by multiple files
    // (FX-09: rules-e executes and its cleanup deletes by job_number while
    // reconciliation imports the same fixture) — file-level parallelism races.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
