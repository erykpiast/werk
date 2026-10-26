import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e-a',
  outputDir: 'test-results-a',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
