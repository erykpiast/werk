import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  timeout: 30000,
  use: { screenshot: "on" },
});
