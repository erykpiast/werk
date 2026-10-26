import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
