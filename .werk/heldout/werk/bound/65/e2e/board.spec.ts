import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('section[data-column]')).toHaveCount(5)
}

type BoardLine = { seq: number; type: string; payload: { number: number; to?: string; title?: string } }
const boardEvents = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as BoardLine)

/** Appends board events to the copy of the fixture the test runs on. */
function appendBoard(werk: Werk, events: { type: string; payload: unknown; actor?: string }[]) {
  let seq = boardEvents(werk).at(-1)!.seq
  const text = events
    .map((e) => JSON.stringify({ seq: ++seq, at: '2026-10-21T02:00:00.000Z', actor: e.actor ?? 'agent', type: e.type, payload: e.payload }))
    .join('\n')
  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), text + '\n')
}

test('81.1 a person sees every fixture ticket in the column its last event names', async ({ page, werk }) => {
  // The column of each ticket from its last event, read from the fixture log.
  const expected = new Map<number, string>()
  for (const e of boardEvents(werk)) {
    if (e.type === 'ticket.planned' && !expected.has(e.payload.number)) expected.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') expected.set(e.payload.number, e.payload.to!)
  }
  expect(new Set(expected.values())).toEqual(new Set(COLUMNS))
  const twice = boardEvents(werk).filter((e) => e.type === 'ticket.moved')
  const movedBuildingThenMerging = [...expected.keys()].find((n) => {
    const tos = twice.filter((e) => e.payload.number === n).map((e) => e.payload.to)
    return tos.at(-1) === 'merging' && tos.includes('building')
  })
  expect(movedBuildingThenMerging).toBeDefined()

  await toBoard(page)
  const names = await page.locator('section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
  expect(names).toEqual(COLUMNS)
  for (const [n, col] of expected) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(page.locator(`section[data-column="${col}"] li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(page.locator(`section[data-column="merging"] li[data-ticket="${movedBuildingThenMerging}"]`)).toHaveCount(1)
  await expect(page.locator(`section[data-column="building"] li[data-ticket="${movedBuildingThenMerging}"]`)).toHaveCount(0)
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page }) => {
  await toBoard(page)
  // Fixture: ticket 2 retried two times, ticket 3 one time.
  const two = ticket(page, 2)
  const one = ticket(page, 3)
  await expect(two).toContainText('Draw the map in a browser')
  await expect(two).toContainText(/\b2\b/)
  await expect(two.locator('[data-badge="retries"]')).toContainText('2')
  await expect(one).toContainText('Open a card from the address bar')
  await expect(one.locator('[data-badge="retries"]')).toHaveCount(0)
  for (const t of [two, one]) {
    await expect(t).not.toContainText('What to build')
    await expect(t).not.toContainText('Acceptance criteria')
    await expect(t).not.toContainText('#map')
    await expect(t).not.toContainText('make test')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // Binder setup on the copy: ticket 6 is blocked by ticket 1 (done) and ticket 3 (ready).
  appendBoard(werk, [
    {
      type: 'ticket.planned',
      payload: { number: 6, title: 'Wait for two tickets', cites: ['map'], blockedBy: [1, 3], stories: [1], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nWait.' },
    },
  ])
  await toBoard(page)
  await expect(page.locator('section[data-column="done"] li[data-ticket="1"]')).toHaveCount(1)
  await expect(page.locator('section[data-column="ready"] li[data-ticket="3"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).not.toContainText('2')
  // Ticket 2 has no blockers.
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG_BRIEF =
  '## What to build\n\n' +
  Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: the drawer shows the whole slice of the ticket, line by line, with no cut.`).join('\n\n') +
  '\n\n## Acceptance criteria\n\n- [ ] The last line of the long brief shows in the drawer.'

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  // Binder setup on the copy: no fixture ticket has a long brief, a blocker and two retries together.
  appendBoard(werk, [
    {
      type: 'ticket.planned',
      payload: { number: 6, title: 'Show the long slice', cites: ['map-hash', 'map'], blockedBy: [2], stories: [3], touches: ['map view'], checks: ['make test', 'make e2e'], brief: LONG_BRIEF },
    },
    { type: 'ticket.retried', payload: { number: 6 } },
    { type: 'ticket.retried', payload: { number: 6 } },
  ])
  await toBoard(page)
  await ticket(page, 6).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Paragraph 1:')
  await expect(slice).toContainText('Paragraph 12:')
  await expect(slice).toContainText('The last line of the long brief shows in the drawer.')
  await expect(meta.getByRole('list', { name: 'cited cards' }).getByRole('link')).toHaveText(['#map-hash', '#map'])
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText(/retries\s*2/)
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')

  const left = (await slice.boundingBox())!
  const right = (await meta.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const columns = page.locator('section[data-column]')
  for (let i = 0; i < 5; i++) await expect(columns.nth(i)).toBeVisible()
  const d = (await drawer.boundingBox())!
  for (let i = 0; i < 5; i++) {
    const c = (await columns.nth(i).boundingBox())!
    expect(c.y + c.height).toBeLessThanOrEqual(d.y)
  }
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await toBoard(page)
  const snapshot = () =>
    page.locator('section[data-column]').evaluateAll((els) =>
      els.map((e) => [e.getAttribute('data-column'), [...e.querySelectorAll('li[data-ticket]')].map((li) => li.getAttribute('data-ticket'))]),
    )
  const before = await snapshot()
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.locator('section[data-column]')).toHaveCount(0)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map-hash')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(detail).toContainText('The address bar names the open card.')
  await toBoard(page)
  expect(await snapshot()).toEqual(before)
})
