import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.pw.ts",
  outputDir: "../test-results/heldout",
  fullyParallel: false,
  workers: 2,
  timeout: 90000,
  expect: { timeout: 8000 },
  use: { browserName: "chromium" },
});
