// Browser tests run under @playwright/test (#werk-test-runner, #werk-test-visual).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // A browser test ends in .e2e.ts, so the unit run under bun test never loads it (#werk-test-runner-e2e-suffix).
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  // Every run writes a PNG as evidence; nothing compares it (#werk-test-visual-judge).
  use: { screenshot: "on" },
});
