import { defineConfig } from "@playwright/test";

// Held-out browser tests. Files end in .pw.ts so `bun test` never loads them.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.pw.ts",
  outputDir: "test-results",
  fullyParallel: true,
  workers: 3,
  timeout: 90000,
  use: { browserName: "chromium" },
});
