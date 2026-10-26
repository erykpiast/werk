import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results/heldout",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  use: { browserName: "chromium" },
});
