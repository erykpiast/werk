import { expect, test } from '../../e2e/harness.ts'
test('smoke', async ({ page }) => { await expect(page.getByRole('list', { name: 'map' })).toBeVisible() })
