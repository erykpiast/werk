import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results/heldout",
  workers: 1,
  use: { browserName: "chromium" },
});
