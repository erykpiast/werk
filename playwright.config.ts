import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/artifacts",
  fullyParallel: true,
  use: { browserName: "chromium" },
});
