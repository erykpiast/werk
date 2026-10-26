import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "c-*.spec.ts",
  outputDir: "./c-artifacts",
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium" },
});
