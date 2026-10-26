import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./results/artifacts",
  fullyParallel: false,
  workers: 2,
  timeout: 90000,
  use: { browserName: "chromium", viewport: { width: 1400, height: 900 } },
});
