import { defineConfig, devices } from '@playwright/test'

// The held-out browser tests. They use the project's own browser harness in e2e/harness.ts.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
