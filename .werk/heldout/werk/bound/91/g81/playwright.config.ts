import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
