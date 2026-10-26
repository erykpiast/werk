import { defineConfig, devices } from '@playwright/test'

/**
 * The browser half of #werk-test-runner. Specs assert DOM and accessibility structure;
 * every spec also writes a PNG to e2e/evidence/, which nothing compares — see
 * #werk-test-visual-judge. Read a PNG through a subagent, not in the main conversation.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${process.env.WERK_E2E_PORT ?? '4941'}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: 'bun e2e/serve-fixture.ts',
    url: `http://localhost:${process.env.WERK_E2E_PORT ?? '4941'}/api/graph`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
})
