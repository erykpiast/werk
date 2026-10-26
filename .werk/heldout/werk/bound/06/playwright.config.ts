// Held-out browser tests: only the files in .werk-heldout/e2e.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  use: { screenshot: "on" },
});
