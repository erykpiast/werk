import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../../test-results/heldout-chat",
  fullyParallel: true,
  workers: 3,
  timeout: 60000,
  expect: { timeout: 8000 },
  reporter: [["list"]],
  use: { browserName: "chromium" },
});
