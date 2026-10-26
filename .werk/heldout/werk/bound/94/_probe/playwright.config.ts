import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: '**/*.spec.ts', outputDir: 'test-results', workers: 1, reporter: [['list']], projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }] })
