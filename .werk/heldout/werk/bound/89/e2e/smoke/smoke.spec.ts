import { expect, test } from '../../../e2e/harness.ts'
test('smoke', async ({ page, werk }) => {
  await expect(page.locator('body')).toBeVisible()
  expect(werk.url).toContain('http')
})
