import { defineConfig, devices } from '@playwright/test'

// Held-out browser specs. Each group runs its own folder: bunx playwright test -c .werk-heldout/playwright.config.ts .werk-heldout/e2e/<group>
export default defineConfig({
  testDir: 'e2e',
  outputDir: process.env.HELDOUT_OUT ?? 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
