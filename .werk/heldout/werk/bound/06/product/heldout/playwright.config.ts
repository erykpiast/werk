import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  outputDir: 'results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: { screenshot: 'on', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
})
