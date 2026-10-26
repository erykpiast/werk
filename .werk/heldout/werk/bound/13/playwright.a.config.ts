import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "a-*.spec.ts",
  outputDir: "results-a",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: { browserName: "chromium", viewport: { width: 1000, height: 800 } },
});
