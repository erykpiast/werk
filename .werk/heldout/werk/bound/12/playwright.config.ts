import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.pw.ts",
  outputDir: "./results",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: { browserName: "chromium" },
});
