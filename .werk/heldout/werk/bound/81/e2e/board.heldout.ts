/** Held-out board specs, on the product's browser harness and its fixture board log. */
import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('[data-column]').first()).toBeVisible()
}

const boardEvents = (dir: string) =>
  readFileSync(join(dir, '.werk', 'board.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

/** Adds events to the board log of the test project, as the Given state. */
function addToBoard(dir: string, events: object[]) {
  let seq = boardEvents(dir).at(-1).seq as number
  const lines = events.map((e) => JSON.stringify({ seq: ++seq, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e }) + '\n')
  appendFileSync(join(dir, '.werk', 'board.jsonl'), lines.join(''))
}

const planned = (n: number, fields: Record<string, unknown>) => ({
  type: 'ticket.planned',
  payload: { number: n, title: `Ticket ${n}`, cites: [], blockedBy: [], stories: [], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nA slice.', ...fields },
})

const layout = (page: Page) =>
  page.locator('[data-column]').evaluateAll((cols) =>
    cols.map((c) => [c.getAttribute('data-column'), [...c.querySelectorAll('li[data-ticket]')].map((t) => t.getAttribute('data-ticket'))]),
  )

test('81.1', async ({ page, werk }) => {
  await openBoard(page)
  const names = await page.locator('[data-column]').evaluateAll((cols) => cols.map((c) => c.getAttribute('data-column')))
  expect(names).toEqual(COLUMNS)
  // The column each ticket's last event names, read from the board log.
  const last = new Map<number, string>()
  for (const e of boardEvents(werk.dir)) {
    if (e.type === 'ticket.planned' && !last.has(e.payload.number)) last.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') last.set(e.payload.number, e.payload.to)
  }
  for (const [n, col] of last) {
    await expect(ticket(page, n)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  expect(boardEvents(werk.dir).filter((e) => e.type === 'ticket.moved' && e.payload.number === 5).map((e) => e.payload.to)).toEqual(['building', 'merging'])
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  for (const other of COLUMNS.filter((c) => c !== 'merging')) await expect(column(page, other).locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2', async ({ page, werk }) => {
  const retries = (n: number) => boardEvents(werk.dir).filter((e) => e.type === 'ticket.retried' && e.payload.number === n).length
  expect([retries(2), retries(3)]).toEqual([2, 1])
  await openBoard(page)
  await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
  await expect(ticket(page, 2)).toContainText('2')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('Acceptance')
    expect(text).not.toMatch(/make test|make e2e|#map|map-hash/)
  }
})

test('81.3', async ({ page, werk }) => {
  // Ticket 1 is in done and ticket 3 is in ready. Ticket 6 waits for both.
  addToBoard(werk.dir, [planned(6, { title: 'Wait for two tickets', blockedBy: [1, 3] })])
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveText(/\b1\b/)
  // Ticket 2 has no blockers.
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG_BRIEF = [
  '## What to build',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: the drawer shows the whole slice, and this line is part of it.`),
  '',
  '## Acceptance criteria',
  '',
  '- [ ] The drawer shows every line of the slice.',
  '- [ ] The last line is here too.',
].join('\n')

test('81.4', async ({ page, werk }) => {
  addToBoard(werk.dir, [
    planned(7, { title: 'A ticket with a long brief', cites: ['map', 'map-hash'], blockedBy: [1], checks: ['make test', 'make e2e'], brief: LONG_BRIEF }),
    { type: 'ticket.retried', payload: { number: 7 } },
    { type: 'ticket.retried', payload: { number: 7 } },
  ])
  await openBoard(page)
  await ticket(page, 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  expect(await slice.locator('.body').textContent()).toBe(LONG_BRIEF)
  await expect(metadata).toContainText('#map')
  await expect(metadata).toContainText('#map-hash')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Fold the cards from the log')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const board = (await page.locator('.board').boundingBox())!
  const box = (await drawer.boundingBox())!
  expect(board.y + board.height).toBeLessThanOrEqual(box.y)
  for (const c of COLUMNS) await expect(column(page, c)).toBeVisible()
})

test('81.5', async ({ page }) => {
  await openBoard(page)
  const before = await layout(page)
  await ticket(page, 3).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await drawer.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map-hash')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(detail).toContainText('The address bar names the open card.')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('[data-column]')).toHaveCount(5)
  expect(await layout(page)).toEqual(before)
})
