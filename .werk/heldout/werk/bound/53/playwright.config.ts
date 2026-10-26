import { defineConfig } from "@playwright/test";

// Held-out browser specs. Run: bunx playwright test -c .werk-heldout/playwright.config.ts
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results/heldout-artifacts",
  fullyParallel: false,
  workers: 2,
  use: { browserName: "chromium" },
});
