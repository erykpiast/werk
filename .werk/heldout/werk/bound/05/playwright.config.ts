import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "**/*.pw.ts", outputDir: "test-results", reporter: [["list"]], use: { screenshot: "on" } });
