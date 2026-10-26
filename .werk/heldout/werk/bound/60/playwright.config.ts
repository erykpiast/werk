import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "browser",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/artifacts",
  fullyParallel: true,
  timeout: 90000,
  use: { browserName: "chromium" },
});
