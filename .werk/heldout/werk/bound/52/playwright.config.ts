import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  outputDir: "/tmp/werk-heldout-pw",
  fullyParallel: false,
  workers: 2,
  timeout: 90000,
  use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
});
