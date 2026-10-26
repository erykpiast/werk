import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser-44.spec.ts",
  outputDir: "../test-results/heldout-board",
  fullyParallel: false,
  workers: 2,
  timeout: 90000,
  use: { browserName: "chromium" },
});
