import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../../test-results/heldout-ui",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: { browserName: "chromium" },
});
