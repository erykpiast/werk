// Held-out browser tests. Run: bunx playwright test -c .werk-heldout/playwright.config.ts <area>
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  timeout: 60000,
  use: { screenshot: "on" },
});
