import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "p2.spec.ts",
  outputDir: join(tmpdir(), "werk-p2-pw"),
  workers: 1,
  use: { browserName: "chromium" },
});
