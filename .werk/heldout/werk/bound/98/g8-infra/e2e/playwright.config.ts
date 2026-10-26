import { defineConfig, devices } from '@playwright/test'

// The held-out browser specs of 98.3. Each spec uses the project's own harness from e2e/harness.ts.
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
