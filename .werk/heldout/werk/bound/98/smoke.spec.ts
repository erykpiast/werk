import { expect, test } from '../e2e/harness.ts'
test('smoke', async ({ page, werk }) => {
  expect(werk.url).toContain('http')
  await expect(page.locator('body')).toBeVisible()
})
