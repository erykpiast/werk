import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "b-*.spec.ts",
  outputDir: "../test-results/heldout-b",
  fullyParallel: false,
  workers: 1,
  timeout: 40000,
  expect: { timeout: 5000 },
  use: { browserName: "chromium" },
});
