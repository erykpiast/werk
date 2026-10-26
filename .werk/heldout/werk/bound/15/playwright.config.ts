import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  use: { browserName: "chromium" },
});
