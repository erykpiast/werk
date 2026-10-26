import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "./results",
  workers: 2,
  timeout: 90000,
  use: { browserName: "chromium" },
});
