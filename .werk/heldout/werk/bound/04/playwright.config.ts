import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "test-results",
  reporter: [["list"]],
  timeout: 30_000,
});
