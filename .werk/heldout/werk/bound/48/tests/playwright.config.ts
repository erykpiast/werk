import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "../results/playwright",
  reporter: [["list"]],
  use: { screenshot: "on" },
});
