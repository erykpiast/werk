import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "/tmp/werk-heldout-repo-release-artifacts",
  workers: 2,
  timeout: 120_000,
  use: { browserName: "chromium" },
});
