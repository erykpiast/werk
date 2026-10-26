import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "/tmp/werk-heldout-browser-b",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { browserName: "chromium" },
});
