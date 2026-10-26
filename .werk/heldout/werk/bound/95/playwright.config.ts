import { defineConfig, devices } from '@playwright/test'

// Held-out browser specs. Each spec imports the project's own e2e harness from ../e2e/harness.ts.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
