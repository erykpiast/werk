// The held-out browser tests run under the project's own Playwright, from this folder.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  workers: 2,
  timeout: 60000,
  use: { screenshot: "on" },
});
