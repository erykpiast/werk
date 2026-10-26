import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "/tmp/werk-heldout-browser-a/artifacts",
  fullyParallel: false,
  workers: 2,
  timeout: 60000,
  use: { browserName: "chromium" },
});
