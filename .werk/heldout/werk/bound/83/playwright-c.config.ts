import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e-c',
  outputDir: 'test-results-c',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
