import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../e2e/harness.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const boardFile = (werk: Werk) => join(werk.dir, '.werk', 'board.jsonl')
const boardEvents = (werk: Werk) =>
  readFileSync(boardFile(werk), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))

/** Adds board events at the end of the board log of the test project, the way the loop writes them. */
function appendBoard(werk: Werk, events: object[]) {
  let seq = boardEvents(werk).at(-1).seq
  for (const e of events) appendFileSync(boardFile(werk), JSON.stringify({ seq: ++seq, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e }) + '\n')
}
const planned = (number: number, fields: Record<string, unknown>) => ({
  type: 'ticket.planned',
  payload: { number, title: `Ticket ${number}`, cites: [], blockedBy: [], stories: [], touches: ['map view'], checks: ['make test'], brief: 'A brief.', ...fields },
})

async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('.board')).toBeVisible()
}
async function columnsSnapshot(page: Page) {
  const names = await page.locator('.board > section').evaluateAll((s) => s.map((e) => e.getAttribute('aria-label')))
  const tickets: Record<string, string[]> = {}
  for (const name of COLUMNS) tickets[name] = await column(page, name).locator('li[data-ticket]').evaluateAll((l) => l.map((e) => e.getAttribute('data-ticket')!))
  return { names, tickets }
}

test('81.1 every fixture ticket shows in the column its last event names', async ({ page, werk }) => {
  await expect(page.getByRole('list', { name: 'map' })).toBeVisible()
  await openBoard(page)
  const expected = new Map<number, string>()
  for (const e of boardEvents(werk)) {
    if (e.type === 'ticket.planned' && !expected.has(e.payload.number)) expected.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') expected.set(e.payload.number, e.payload.to)
  }
  const states = new Set(expected.values())
  for (const c of COLUMNS) expect(states.has(c)).toBe(true)
  const snap = await columnsSnapshot(page)
  expect(snap.names).toEqual(COLUMNS)
  for (const [n, col] of expected) {
    await expect(ticket(page, n)).toHaveCount(1)
    expect(snap.tickets[col]).toContain(String(n))
  }
  const moved = boardEvents(werk).filter((e) => e.type === 'ticket.moved')
  const viaBuilding = [...expected.keys()].find((n) => {
    const tos = moved.filter((e) => e.payload.number === n).map((e) => e.payload.to)
    return tos.join(',') === 'building,merging'
  })
  expect(viaBuilding).toBeDefined()
  expect(snap.tickets.merging).toContain(String(viaBuilding))
  expect(snap.tickets.building).not.toContain(String(viaBuilding))
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page, werk }) => {
  const events = boardEvents(werk)
  const retries = new Map<number, number>()
  for (const e of events) if (e.type === 'ticket.retried') retries.set(e.payload.number, (retries.get(e.payload.number) ?? 0) + 1)
  const two = [...retries].find(([, r]) => r === 2)![0]
  const one = [...retries].find(([, r]) => r === 1)![0]
  const fields = (n: number) => events.filter((e) => e.type === 'ticket.planned' && e.payload.number === n).at(-1).payload
  await openBoard(page)
  await expect(ticket(page, two)).toContainText(fields(two).title)
  await expect(ticket(page, two)).toContainText('2')
  await expect(ticket(page, two).locator('[data-badge="retries"]')).toHaveText(/2/)
  await expect(ticket(page, one)).toContainText(fields(one).title)
  await expect(ticket(page, one).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [two, one]) {
    const text = (await ticket(page, n).textContent()) ?? ''
    const f = fields(n)
    for (const line of f.brief.split('\n').filter((l: string) => l.trim() !== '' && !l.startsWith('#'))) expect(text).not.toContain(line)
    for (const id of f.cites) expect(text).not.toContain(`#${id}`)
    for (const c of f.checks) expect(text).not.toContain(c)
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // Ticket 1 is done in the fixture. Ticket 7 is planned and stays in ready. Ticket 6 waits on both.
  appendBoard(werk, [planned(7, { title: 'A ready blocker' }), planned(6, { title: 'Blocked by two', blockedBy: [1, 7] })])
  await page.goto(werk.url)
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="7"]')).toBeVisible()
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveText(/\b1\b/)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG_BRIEF = [
  '## What to build',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: the board shows each ticket and the drawer shows its whole slice, line by line.`),
  '',
  '## Acceptance criteria',
  '',
  '- [ ] The drawer shows the full brief.',
].join('\n')

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  appendBoard(werk, [
    planned(6, { title: 'The long ticket', cites: ['map', 'map-hash'], blockedBy: [2], checks: ['make test', 'make e2e'], brief: LONG_BRIEF }),
    { type: 'ticket.retried', payload: { number: 6 } },
    { type: 'ticket.retried', payload: { number: 6 } },
  ])
  await page.goto(werk.url)
  await openBoard(page)
  await ticket(page, 6).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  const box = (await drawer.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(board.y + board.height)
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  const sliceText = (await slice.innerText()).replace(/\s+/g, ' ')
  for (const line of LONG_BRIEF.split('\n').filter((l) => l.trim() !== '')) expect(sliceText).toContain(line.replace(/\s+/g, ' '))
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  await expect(metadata).toContainText('#map')
  await expect(metadata).toContainText('#map-hash')
  await expect(metadata).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata).toContainText('make test')
  await expect(metadata).toContainText('make e2e')
  for (const c of COLUMNS) await expect(column(page, c)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page, werk }) => {
  await openBoard(page)
  const before = await columnsSnapshot(page)
  // Ticket 3 cites #map-hash, a card on the map.
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('link', { name: '#map-hash' }).click()
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map-hash')
  await expect(page.locator('.board')).toHaveCount(0)
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(detail).toContainText('The address bar names the open card.')
  await openBoard(page)
  expect(await columnsSnapshot(page)).toEqual(before)
  expect(werk.dir).toBeTruthy()
})
