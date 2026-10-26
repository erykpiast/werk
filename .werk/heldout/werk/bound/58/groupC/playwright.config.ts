import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 2,
  use: { browserName: "chromium" },
});
