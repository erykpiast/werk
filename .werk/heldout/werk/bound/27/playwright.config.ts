import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results/heldout-artifacts",
  fullyParallel: true,
  workers: 4,
  timeout: 90000,
  use: { browserName: "chromium", viewport: { width: 1400, height: 900 } },
});
