/** Held-out steps 81.1-81.5: the ticket board. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}

/** Appends board events after the fixture's, so the test project holds the Given state. */
function addBoardEvents(werk: Werk, events: object[]) {
  const path = join(werk.dir, '.werk', 'board.jsonl')
  let seq = readFileSync(path, 'utf8').trim().split('\n').length
  for (const e of events) {
    seq++
    appendFileSync(path, JSON.stringify({ seq, at: `2026-10-21T02:${String(seq).padStart(2, '0')}:00.000Z`, actor: 'agent', ...e }) + '\n')
  }
}

const planned = (number: number, title: string, extra: object = {}) => ({
  type: 'ticket.planned',
  payload: { number, title, cites: [], blockedBy: [], stories: [1], touches: ['map view'], checks: ['make test'], brief: `## What to build\n\nBrief of ${title}.`, ...extra },
})

test('81.1 every fixture ticket in the column its last event names', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('section.column')).toHaveCount(5)
  const names = await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
  expect(names).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  const expected: [string, number[]][] = [['blocked', [4]], ['ready', [3]], ['building', [2]], ['merging', [5]], ['done', [1]]]
  for (const [name, numbers] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(ticket(page, 5)).toHaveCount(1)
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await openBoard(page)
  // Fixture: ticket 2 retried two times, ticket 3 one time.
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('#map')
    expect(text).not.toContain('make test')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  addBoardEvents(werk, [planned(7, 'A ready blocker'), planned(6, 'Blocked by two', { blockedBy: [1, 7] })])
  await openBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="7"]')).toHaveCount(1)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const brief = '## What to build\n\n' + 'A long brief sentence that goes on. '.repeat(30) + '\n\n## Acceptance criteria\n\n- [ ] The final criterion line.'
  addBoardEvents(werk, [
    planned(8, 'A ticket with a long brief', { cites: ['map', 'log'], blockedBy: [2], checks: ['make test', 'make e2e'], brief }),
    { type: 'ticket.retried', payload: { number: 8 } },
    { type: 'ticket.retried', payload: { number: 8 } },
  ])
  await openBoard(page)
  await ticket(page, 8).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('The final criterion line.')
  expect((await slice.innerText()).replace(/\s+/g, ' ')).toContain('A long brief sentence that goes on. '.repeat(30).trim())
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#log')
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText('retries2')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const l = (await slice.boundingBox())!
  const r = (await meta.boundingBox())!
  expect(l.x + l.width).toBeLessThanOrEqual(r.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('li[data-ticket]')).toHaveCount(5)
  const before = await page.locator('section.column').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('data-column'), [...e.querySelectorAll('li[data-ticket]')].map((li) => li.getAttribute('data-ticket'))]),
  )
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await openBoard(page)
  await expect(page.locator('section.column')).toHaveCount(5)
  await expect(page.locator('li[data-ticket]')).toHaveCount(5)
  const after = await page.locator('section.column').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('data-column'), [...e.querySelectorAll('li[data-ticket]')].map((li) => li.getAttribute('data-ticket'))]),
  )
  expect(after).toEqual(before)
})
