import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "**/*.spec.ts",
  outputDir: join(import.meta.dirname, "results"),
  fullyParallel: true,
  workers: 2,
  timeout: 120000,
  expect: { timeout: 15000 },
  use: { browserName: "chromium", headless: true, screenshot: "only-on-failure" },
});
