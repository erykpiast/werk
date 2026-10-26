import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.WERK_E2E_PORT ?? 4951)

/**
 * The browser tests. They assert on page structure; each test also saves a PNG to
 * e2e/evidence/ as evidence, which nothing compares.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `bun e2e/serve-fixture.ts ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
})
