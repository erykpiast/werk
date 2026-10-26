import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "./artifacts",
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium" },
});
