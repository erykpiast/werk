import { defineConfig, devices } from '@playwright/test'

// Held-out browser specs for the map (steps 69–72). They use the project's own harness.
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
