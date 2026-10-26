import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  timeout: 90_000,
  workers: 2,
  reporter: [["list"]],
  use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
});
