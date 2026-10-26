import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results/heldout-artifacts",
  fullyParallel: false,
  workers: 2,
  timeout: 90_000,
  use: { browserName: "chromium" },
});
