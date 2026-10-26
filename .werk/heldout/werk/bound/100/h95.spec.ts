/** Held-out 95.4: a browser test that h95.test.ts starts with the real agent first on PATH. */
import { expect, test } from '../e2e/harness.ts'

test('95.4 probe: a browser test that loads the map', async ({ page, werk }) => {
  await page.goto(werk.url)
  await expect(page.locator('body')).toBeVisible()
})
