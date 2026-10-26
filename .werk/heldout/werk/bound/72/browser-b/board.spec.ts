/** Held-out steps 81.1–81.5: the board of the test project. */
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}
const COLS = ['blocked', 'ready', 'building', 'merging', 'done']

test.describe('fixture board', () => {
  test('81.1 every fixture ticket sits in the column its last event names', async ({ page }) => {
    await expect(page.getByRole('list', { name: 'map' })).toBeVisible()
    await toBoard(page)
    await expect(page.locator('section[data-column]')).toHaveCount(5)
    const names = await page.locator('section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
    expect(names).toEqual(COLS)
    const headings = await page.locator('section[data-column] > h2').allInnerTexts()
    expect(headings.map((h) => h.split(/\s/)[0]!.toLowerCase())).toEqual(COLS)
    const expected: [string, number[]][] = [['blocked', [4]], ['ready', [3]], ['building', [2]], ['merging', [5]], ['done', [1]]]
    for (const [name, numbers] of expected) {
      await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
      for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    }
    await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
    await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
  })

  test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
    await toBoard(page)
    // Ticket 2 retried two times, ticket 3 one time in the fixture board log.
    await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
    await expect(ticket(page, 2).locator('[data-badge="retries"]')).toHaveText('↻ 2')
    await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
    await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
    await expect(ticket(page, 3)).not.toContainText('2')
    for (const n of [2, 3]) {
      const t = ticket(page, n)
      await expect(t).not.toContainText('What to build')
      await expect(t).not.toContainText('#map')
      await expect(t).not.toContainText('make test')
      await expect(t).not.toContainText('make e2e')
    }
    await expect(ticket(page, 2)).not.toContainText('The server sends the fold')
    await expect(ticket(page, 3)).not.toContainText('A person opens a card')
  })

  test('81.5 a cited card id in the drawer opens that card on the map, and the board comes back the same', async ({ page }) => {
    await toBoard(page)
    const snapshot = async () => {
      const out: Record<string, string[]> = {}
      for (const c of COLS) out[c] = await column(page, c).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
      return out
    }
    await expect(page.locator('li[data-ticket]')).toHaveCount(5)
    const before = await snapshot()
    await ticket(page, 3).getByRole('link').click()
    await page.getByRole('region', { name: 'drawer' }).getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
    await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
    const card = page.getByTestId('card')
    await expect(card).toHaveAttribute('data-card-id', 'map-hash')
    await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
    await expect(card.locator('.body')).toContainText('The address bar names the open card.')
    await toBoard(page)
    await expect(page.locator('section[data-column]')).toHaveCount(5)
    await expect(page.locator('li[data-ticket]')).toHaveCount(5)
    expect(await snapshot()).toEqual(before)
  })
})

test.describe('custom board', () => {
  test.use({ boardLog: join(import.meta.dirname, 'board-custom.jsonl') })

  test('81.3 a blocker count counts only blockers that are not done', async ({ page }) => {
    await toBoard(page)
    // Ticket 3 is blocked by 1 (done) and 2 (ready). Ticket 4 has no blockers.
    await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
    await expect(column(page, 'ready').locator('li[data-ticket="2"]')).toHaveCount(1)
    await expect(ticket(page, 3).locator('[data-badge="blockers"]')).toHaveText('⛔ 1')
    await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
  })

  test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page }) => {
    await toBoard(page)
    await ticket(page, 3).getByRole('link').click()
    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer).toBeVisible()
    const slice = drawer.getByRole('article', { name: 'slice' })
    const metadata = drawer.getByRole('complementary', { name: 'metadata' })
    for (let i = 1; i <= 12; i++) await expect(slice).toContainText(`Paragraph ${i} of the long brief`)
    await expect(slice).toContainText('The last line of the brief.')
    await expect(slice).toContainText('A reload opens the same card.')
    await expect(metadata.getByRole('list', { name: 'cited cards' }).getByRole('link')).toHaveText(['#map-hash', '#map'])
    await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
    await expect(metadata).toContainText(/retries\s*2/)
    await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')
    await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')
    const l = (await slice.boundingBox())!
    const r = (await metadata.boundingBox())!
    expect(l.x + l.width).toBeLessThanOrEqual(r.x)
    const board = page.locator('.board')
    await expect(board).toBeVisible()
    for (const c of COLS) await expect(column(page, c)).toBeVisible()
    const b = (await board.boundingBox())!
    expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(b.y + b.height)
  })
})
