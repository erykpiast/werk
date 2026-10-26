import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  workers: 1,
  timeout: 120000,
  use: { browserName: "chromium" },
});
