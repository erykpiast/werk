import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "b-*.e2e.ts",
  outputDir: "b-test-results",
  reporter: [["list"]],
  workers: 1,
  use: { screenshot: "on" },
});
