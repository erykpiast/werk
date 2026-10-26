import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../../../e2e/harness.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}
const columnNames = (page: Page) => page.locator('.board > section').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const layout = (page: Page) =>
  page.locator('.board > section').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('aria-label'), [...e.querySelectorAll('li[data-ticket]')].map((li) => Number(li.getAttribute('data-ticket')))]),
  )

type Ev = { seq: number; at: string; actor: string; type: string; payload: Record<string, unknown> }
const fields = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
  number: n,
  title,
  cites: [],
  blockedBy: [],
  stories: [1],
  touches: ['map view'],
  checks: ['make test'],
  brief: `## What to build\n\nThe brief of ticket ${n}.`,
  ...extra,
})
/** Writes a board log in the test project copy (a Given), before the person opens the board. */
function writeBoard(dir: string, events: Omit<Ev, 'seq' | 'at' | 'actor'>[]) {
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: `2026-10-21T01:${String(i).padStart(2, '0')}:00.000Z`, actor: 'agent', ...e }))
  writeFileSync(join(dir, '.werk', 'board.jsonl'), lines.join('\n') + '\n')
}

// 81.1
// Scenario: A person sees every fixture ticket in the column its last event names
// Given the test project has a board log with tickets in each ticket state
// And one ticket was moved to building and then moved again to merging
// When the person opens the test project in the browser
// And the person switches from the map to the board
// Then the person sees five columns in the order blocked, ready, building, merging, done
// And each ticket appears as one card in the column that its last event names
// And the ticket that moved from building to merging appears only in merging
// Reading: the fixture board log already holds this (ticket 5 moved to building, then merging).
// The expected column of each ticket is read from the raw log here: its last ticket.moved names
// it, and a ticket with no move is in ready (where a plan puts it).
test('81.1', async ({ page, werk }) => {
  const events = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Ev)
  const expected = new Map<number, string>()
  for (const e of events) {
    if (e.type === 'ticket.planned') expected.set(e.payload.number as number, expected.get(e.payload.number as number) ?? 'ready')
    if (e.type === 'ticket.moved') expected.set(e.payload.number as number, e.payload.to as string)
  }
  expect(new Set(expected.values())).toEqual(new Set(COLUMNS)) // every state is in the fixture
  const movedTwice = events.filter((e) => e.type === 'ticket.moved' && e.payload.number === 5).map((e) => e.payload.to)
  expect(movedTwice).toEqual(['building', 'merging'])

  await expect(page.getByRole('navigation', { name: 'views' })).toBeVisible()
  await toBoard(page)
  await expect(column(page, 'done')).toBeVisible()
  expect(await columnNames(page)).toEqual(COLUMNS)
  for (const [n, col] of expected) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

// 81.2
// Scenario: A ticket card shows a retry count only after more than one retry
// Given the test project has a board log with one ticket that retried two times
// And another ticket that retried one time
// When the person opens the board
// Then the card of the ticket with two retries shows its title and a retry count of 2
// And the card of the ticket with one retry shows its title and no retry count
// And neither card shows the ticket brief, the cited cards, or the checks
// Reading: the fixture log has ticket 2 with two retries and ticket 3 with one.
test('81.2', async ({ page }) => {
  await toBoard(page)
  const two = ticket(page, 2)
  const one = ticket(page, 3)
  await expect(two).toContainText('Draw the map in a browser')
  await expect(two.locator('[data-badge="retries"]')).toHaveText(/\b2\b/)
  await expect(one).toContainText('Open a card from the address bar')
  await expect(one.locator('[data-badge="retries"]')).toHaveCount(0)
  await expect(one).not.toContainText('↻')
  for (const [card, brief, cites] of [
    [two, 'The server sends the fold', ['#map']],
    [one, 'A person opens a card, and its id goes into the location hash', ['#map-hash', 'map-hash', '#map']],
  ] as const) {
    await expect(card).not.toContainText(brief)
    await expect(card).not.toContainText('What to build')
    await expect(card).not.toContainText('Acceptance criteria')
    for (const c of cites) await expect(card).not.toContainText(c)
    await expect(card).not.toContainText('make test')
    await expect(card).not.toContainText('make e2e')
  }
})

// 81.3
// Scenario: A ticket card counts only the blockers that are not done
// Given the test project has a board log with a ticket blocked by two other tickets
// And one of the two blocking tickets is in done
// And the other blocking ticket is in ready
// When the person opens the board
// Then the card of the blocked ticket shows a blocker count of 1
// And a ticket with no blockers shows no blocker count
// Reading: in the fixture log the second blocker of ticket 3 is in building, not ready, so this
// test writes its own board log in the project copy before the person opens the board.
test('81.3', async ({ page, werk }) => {
  writeBoard(werk.dir, [
    { type: 'ticket.planned', payload: fields(1, 'Done blocker') },
    { type: 'ticket.planned', payload: fields(2, 'Ready blocker') },
    { type: 'ticket.planned', payload: fields(3, 'Blocked by two', { blockedBy: [1, 2] }) },
    { type: 'ticket.planned', payload: fields(4, 'No blockers') },
    { type: 'ticket.moved', payload: { number: 1, to: 'building' } },
    { type: 'ticket.moved', payload: { number: 1, to: 'merging' } },
    { type: 'ticket.moved', payload: { number: 1, to: 'done' } },
  ])
  await toBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="2"]')).toBeVisible()
  await expect(ticket(page, 3).locator('[data-badge="blockers"]')).toHaveText(/\b1\b/)
  await expect(ticket(page, 4)).toBeVisible()
  await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
  await expect(ticket(page, 4)).not.toContainText('⛔')
})

// 81.4
// Scenario: A click on a ticket opens a drawer with the slice and its metadata
// Given the person has the board of the test project open
// When the person clicks a ticket card that has a long brief, cited cards, a blocker, and two retries
// Then a drawer opens under the board
// And the left side of the drawer shows the full text of the ticket slice
// And the right side of the drawer shows the cited card ids, the blocking ticket, the retry count, and the checks
// And the board columns stay visible above the drawer
// Reading: no fixture ticket has all four (ticket 2 has two retries but no blocker), so this test
// writes its own board log in the project copy before the person opens the board.
test('81.4', async ({ page, werk }) => {
  const brief = [
    '## What to build',
    '',
    ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: the person opens a card, and its id goes into the location hash, so that a reload opens the same card and a link to it can be shared with another person.`),
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Opening a card puts its id in the hash.',
    '- [ ] A reload opens the same card.',
  ].join('\n')
  writeBoard(werk.dir, [
    { type: 'ticket.planned', payload: fields(1, 'Fold the cards from the log') },
    { type: 'ticket.planned', payload: fields(7, 'Open a card from the address bar', { brief, cites: ['map-hash', 'fold'], blockedBy: [1], checks: ['make test', 'make e2e'] }) },
    { type: 'ticket.retried', payload: { number: 7 } },
    { type: 'ticket.retried', payload: { number: 7 } },
  ])
  await toBoard(page)
  await expect(ticket(page, 7)).toBeVisible()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveCount(0)
  await ticket(page, 7).getByRole('link', { name: 'Open a card from the address bar' }).click()

  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toBeVisible()
  const sliceText = (await slice.textContent()) ?? ''
  expect(sliceText).toContain(brief)

  await expect(metadata).toContainText('#map-hash')
  await expect(metadata).toContainText('#fold')
  await expect(metadata).toContainText('Fold the cards from the log')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata).toContainText('make test')
  await expect(metadata).toContainText('make e2e')

  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)

  const board = (await page.locator('.board').boundingBox())!
  const d = (await drawer.boundingBox())!
  expect(d.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const name of COLUMNS) await expect(column(page, name)).toBeVisible()
})

// 81.5
// Scenario: A click on a cited card id in the drawer opens that card on the map
// Given the person has the board of the test project open
// And the person has opened the drawer of a ticket that cites a card on the map
// When the person clicks that cited card id in the drawer
// Then the view switches from the board to the map
// And the map shows that card open, with its title and body
// When the person switches back to the board
// Then the person sees the same five columns with the same tickets
// Reading: fixture ticket 3 cites "map-hash", a card in the fixture map.
test('81.5', async ({ page }) => {
  await toBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  const before = await layout(page)
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()

  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.board')).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')

  await toBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  expect(await columnNames(page)).toEqual(COLUMNS)
  expect(await layout(page)).toEqual(before)
})
