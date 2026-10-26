// Held-out browser tests. Run: bunx playwright test --config .werk-heldout/playwright.config.ts <file>
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  use: { screenshot: "on" },
});
