import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "./.results",
  timeout: 90000,
  workers: 1,
  use: { browserName: "chromium" },
});
