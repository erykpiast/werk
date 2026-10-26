import { defineConfig, devices } from '@playwright/test'

// The held-out browser specs. They use the product's browser harness (e2e/harness.ts).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.heldout\.ts$/,
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
