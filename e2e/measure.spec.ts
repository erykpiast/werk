// The Measure tab's test panel (#vi-flow-ms-tests): the recorded unit test runs, and which
// failures were a timeout. serve-fixture.ts writes three runs: one clean, one with a timeout,
// one with a timeout and a plain failure. Assertions are on structure only.
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.addInitScript(() => localStorage.clear())
})

test('the test panel counts the runs, the runs with a timeout, and names each failed test', async ({ page }) => {
  await page.goto('/')
  await page.locator('#view-switch [data-view="measure"], [data-view="measure"]').first().click()
  const panel = page.locator('#ms-tests')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading')).toContainText('Which unit tests fail')

  const tiles = panel.locator('.flow-tile')
  await expect(tiles.nth(0)).toContainText('3')
  await expect(tiles.nth(1)).toContainText('2 · 67%')
  await expect(tiles.nth(2)).toContainText('2 · 67%')
  await expect(tiles.nth(3)).toContainText('2')

  // One bar per run: one clean, two with a timeout.
  await expect(panel.locator('.rs-strip i')).toHaveCount(3)
  await expect(panel.locator('.rs-strip i.rs-timeout')).toHaveCount(2)
  await expect(panel.locator('.rs-strip i.rs-ok')).toHaveCount(1)

  // The timeout test comes first, failed in 2 of 3 runs, both times on a time limit.
  const rows = panel.locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('a classifier that times out counts as not looping')
  await expect(rows.first()).toContainText('2 of 3')
  await expect(rows.first().locator('td.num b')).toHaveText('2')
  await expect(rows.nth(1)).toContainText('a plain assertion')

  // The rail marks the panel: a timeout is a mark outside its band.
  await expect(page.locator('.mr-q[data-goto="tests"] .mr-dot')).toHaveCount(1)
})
