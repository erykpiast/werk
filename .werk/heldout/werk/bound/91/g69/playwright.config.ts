import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /.*\.spec\.ts$/,
  outputDir: join(import.meta.dirname, 'test-results'),
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
