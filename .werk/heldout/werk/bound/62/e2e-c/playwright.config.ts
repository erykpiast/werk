import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "**/*.spec.ts",
  outputDir: `${import.meta.dirname}/results`,
  workers: 2,
  timeout: 120000,
  expect: { timeout: 15000 },
  use: { browserName: "chromium", headless: true, screenshot: "only-on-failure" },
});
