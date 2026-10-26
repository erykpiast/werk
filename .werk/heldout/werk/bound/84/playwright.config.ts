import { defineConfig, devices } from '@playwright/test'

/** The held-out browser specs. Each test boots its own werk server on its own temporary project. */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
