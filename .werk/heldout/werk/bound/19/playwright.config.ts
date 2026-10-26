import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: ".results",
  timeout: 90_000,
  expect: { timeout: 6_000 },
  workers: 2,
  use: { browserName: "chromium" },
});
