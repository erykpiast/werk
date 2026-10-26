import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "/tmp/werk-heldout-infra-results",
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium" },
});
