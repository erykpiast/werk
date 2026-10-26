import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "results",
  fullyParallel: false,
  workers: 2,
  timeout: 90_000,
  use: { browserName: "chromium" },
});
