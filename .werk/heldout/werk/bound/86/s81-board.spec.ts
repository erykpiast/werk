import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../e2e/harness.ts'

const COLS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const boardFile = (werk: Werk) => join(werk.dir, '.werk', 'board.jsonl')
const boardEvents = (werk: Werk) =>
  readFileSync(boardFile(werk), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number; type: string; payload: Record<string, unknown> })

function append(werk: Werk, events: { type: string; payload: unknown }[]) {
  let seq = boardEvents(werk).at(-1)!.seq
  for (const e of events) appendFileSync(boardFile(werk), JSON.stringify({ seq: ++seq, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e }) + '\n')
}

async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}

test('81.1 every fixture ticket is in the column its last event names', async ({ page, werk }) => {
  const events = boardEvents(werk)
  const expected = new Map<number, string>()
  for (const e of events) {
    if (e.type === 'ticket.planned') expected.set(e.payload.number as number, expected.get(e.payload.number as number) ?? 'ready')
    if (e.type === 'ticket.moved') expected.set(e.payload.number as number, e.payload.to as string)
  }
  expect(new Set(expected.values())).toEqual(new Set(COLS))
  await openBoard(page)
  await expect(page.locator('section.column h2')).toHaveText(COLS.map((c) => new RegExp(`^${c}`)))
  const names = await page.locator('section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLS)
  for (const [n, col] of expected) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page }) => {
  await openBoard(page)
  const two = ticket(page, 2)
  const one = ticket(page, 3)
  await expect(two).toContainText('Draw the map in a browser')
  await expect(two.locator('[data-badge="retries"]')).toContainText('2')
  await expect(one).toContainText('Open a card from the address bar')
  await expect(one.locator('[data-badge="retries"]')).toHaveCount(0)
  for (const t of [two, one]) {
    await expect(t).not.toContainText('What to build')
    await expect(t).not.toContainText('make test')
  }
  await expect(two).not.toContainText('The server sends the fold')
  await expect(two).not.toContainText('#map')
  await expect(one).not.toContainText('A person opens a card')
  await expect(one).not.toContainText('map-hash')
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  append(werk, [
    { type: 'ticket.planned', payload: { number: 6, title: 'Blocked by a done and a ready ticket', cites: ['map'], blockedBy: [1, 3], stories: [1], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nX.' } },
  ])
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveText(/\b1\b/)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).not.toHaveText(/2/)
  // Ticket 2 has no blockers.
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG = '## What to build\n\n' + 'The long brief keeps every sentence of the slice. '.repeat(30) + '\n\n## Acceptance criteria\n\n- [ ] The last line of the long brief.'

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  append(werk, [
    { type: 'ticket.planned', payload: { number: 7, title: 'A ticket with a long brief', cites: ['map', 'map-hash'], blockedBy: [1], stories: [2], touches: ['map view'], checks: ['make test', 'make e2e'], brief: LONG } },
    { type: 'ticket.retried', payload: { number: 7 } },
    { type: 'ticket.retried', payload: { number: 7 } },
  ])
  await openBoard(page)
  await ticket(page, 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  expect((await slice.innerText()).replace(/\s+/g, ' ')).toContain(LONG.replace(/\s+/g, ' ').trim())
  await expect(meta.getByRole('list', { name: 'cited cards' }).getByRole('link')).toHaveText(['#map', '#map-hash'])
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Fold the cards from the log')
  await expect(meta).toContainText(/retries\s*2/)
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const left = (await slice.boundingBox())!
  const right = (await meta.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const c of COLS) await expect(column(page, c)).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(column(page, 'ready')).toBeInViewport()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  const snapshot = async () =>
    page.locator('section[data-column]').evaluateAll((els) =>
      els.map((e) => [e.getAttribute('aria-label'), [...e.querySelectorAll('li[data-ticket]')].map((li) => li.getAttribute('data-ticket'))]),
    )
  await expect(ticket(page, 3)).toBeVisible()
  const before = await snapshot()
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveCount(0)
  const cardView = page.getByTestId('card')
  await expect(cardView).toHaveAttribute('data-card-id', 'map-hash')
  await expect(cardView.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(cardView).toContainText('The address bar names the open card.')
  await openBoard(page)
  await expect(ticket(page, 3)).toBeVisible()
  expect(await snapshot()).toEqual(before)
})
