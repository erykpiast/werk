import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  workers: 2,
  use: { screenshot: "on" },
});
