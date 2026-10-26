import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: join(tmpdir(), "werk-heldout-pw-results"),
  use: { browserName: "chromium" },
});
