import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Postgres-backed tests share one ledger; avoid parallel file races.
    fileParallelism: false,
  },
});
