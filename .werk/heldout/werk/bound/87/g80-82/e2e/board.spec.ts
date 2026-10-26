/** Held-out steps 81.1–81.5: the board in a browser, on the fixture project. */
import type { Page } from '@playwright/test'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../../e2e/harness.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}

test('81.1 every fixture ticket is in the column its last event names', async ({ page }) => {
  await expect(page.getByTestId('card').or(page.locator('.tree')).first()).toBeVisible()
  await toBoard(page)
  await expect(page.locator('section.column')).toHaveCount(5)
  expect(await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))).toEqual(COLUMNS)
  const expected: Record<string, number[]> = { blocked: [4], ready: [3, 6], building: [2], merging: [5], done: [1] }
  for (const [name, numbers] of Object.entries(expected)) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await toBoard(page)
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('make test')
    expect(text).not.toMatch(/#map|#map-hash|#log|#fold/)
  }
})

test('81.3 a blocker count counts only blockers that are not done', async ({ page }) => {
  await toBoard(page)
  await expect(ticket(page, 3).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  // Given: a ticket with a long brief, cited cards, a blocker and two retries, in the board log.
  const long = '## What to build\n\n' + 'The drawer shows the whole slice of the ticket, every line of it. '.repeat(20) + 'THE END OF THE SLICE.\n\n## Acceptance criteria\n\n- [ ] The drawer shows the whole slice.'
  const at = '2026-10-21T02:00:00.000Z'
  appendFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    [
      { seq: 18, at, actor: 'agent', type: 'ticket.planned', payload: { number: 7, title: 'Show the long slice', cites: ['map', 'map-hash'], blockedBy: [2], stories: [1], touches: ['map view'], checks: ['make test', 'make e2e'], brief: long } },
      { seq: 19, at, actor: 'agent', type: 'ticket.retried', payload: { number: 7 } },
      { seq: 20, at, actor: 'agent', type: 'ticket.retried', payload: { number: 7 } },
    ].map((e) => JSON.stringify(e) + '\n').join(''),
  )
  await page.goto(werk.url)
  await toBoard(page)
  await ticket(page, 7).getByRole('link', { name: 'Show the long slice' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('THE END OF THE SLICE.')
  await expect(slice).toContainText('The drawer shows the whole slice.')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const name of COLUMNS) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await toBoard(page)
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.locator('section.column')).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await toBoard(page)
  const expected: Record<string, number[]> = { blocked: [4], ready: [3, 6], building: [2], merging: [5], done: [1] }
  await expect(page.locator('section.column')).toHaveCount(5)
  expect(await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))).toEqual(COLUMNS)
  for (const [name, numbers] of Object.entries(expected)) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
})
