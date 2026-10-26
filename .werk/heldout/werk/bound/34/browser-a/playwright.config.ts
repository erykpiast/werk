import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "results",
  fullyParallel: true,
  workers: 3,
  use: { browserName: "chromium" },
});
