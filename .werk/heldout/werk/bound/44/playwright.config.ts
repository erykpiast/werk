import { defineConfig } from "@playwright/test";

// The held-out browser tests. They use the checkout's own e2e support code (server, fake agent).
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.pw.ts",
  outputDir: "../test-results/heldout-artifacts",
  fullyParallel: true,
  workers: 2,
  timeout: 90000,
  use: { browserName: "chromium" },
});
