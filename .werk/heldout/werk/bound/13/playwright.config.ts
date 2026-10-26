import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  timeout: 60_000,
  workers: 2,
  use: { screenshot: "on" },
});
