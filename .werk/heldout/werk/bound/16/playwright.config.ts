import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "browser",
  testMatch: "**/*.pw.ts",
  outputDir: "results/artifacts",
  workers: 1,
  timeout: 90000,
  use: { browserName: "chromium" },
});
