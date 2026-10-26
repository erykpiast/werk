import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "./results",
  workers: 1,
  timeout: 240_000,
  use: { browserName: "chromium" },
});
