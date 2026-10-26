import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

export const EVIDENCE_DIR = join(import.meta.dirname, 'evidence')

/**
 * The browser test. After each test it saves a full-page PNG to e2e/evidence/, named after
 * the spec file and the test title. The PNG is evidence to look at; no test compares it.
 */
export const test = base.extend<{ evidence: void }>({
  evidence: [
    async ({ page }, use, info) => {
      await use()
      mkdirSync(EVIDENCE_DIR, { recursive: true })
      const spec = info.file.split('/').at(-1)!.replace(/\.e2e\.ts$/, '')
      const title = info.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
      await page.screenshot({ path: join(EVIDENCE_DIR, `${spec}--${title}.png`), fullPage: true })
    },
    { auto: true },
  ],
})
