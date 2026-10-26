/** Held-out steps 81.x: the board in the browser, on the e2e fixture project. */
import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './harness.ts'

test.use({ seed: 'fixture' })

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const FIXTURE_BOARD = join(import.meta.dirname, '..', '..', 'e2e', 'fixture-project', '.werk', 'board.jsonl')

type Ev = { seq: number; type: string; payload: Record<string, unknown> & { number: number } }
const eventsOf = (text: string): Ev[] =>
  text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Ev)

/** The column of each ticket by its last event, computed here and not by the product's fold. */
function expectedColumns(events: Ev[]): Map<number, string> {
  const col = new Map<number, string>()
  for (const e of events) {
    if (e.type === 'ticket.planned' && !col.has(e.payload.number)) col.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') col.set(e.payload.number, e.payload.to as string)
  }
  return col
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)

async function openBoard(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.getByRole('heading', { name: 'The board' })).toBeVisible()
}

/** Each column's ticket numbers, read from the page. */
async function columnsOnPage(page: Page): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const name of COLUMNS) {
    out[name] = await column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  }
  return out
}

let seq = 100
const line = (type: string, payload: unknown, actor = 'agent') =>
  JSON.stringify({ seq: seq++, at: '2026-10-21T02:00:00.000Z', actor, type, payload }) + '\n'
const planned = (p: { number: number; title: string; cites?: string[]; blockedBy?: number[]; brief?: string }) =>
  line('ticket.planned', {
    number: p.number,
    title: p.title,
    cites: p.cites ?? [],
    blockedBy: p.blockedBy ?? [],
    stories: [1],
    touches: ['map view'],
    checks: ['make test', 'make e2e'],
    brief: p.brief ?? '## What to build\n\nA thing.\n\n## Acceptance criteria\n\n- [ ] It works.',
  })

test('81.1 A person sees every fixture ticket in the column its last event names', async ({ page, werk }) => {
  const events = eventsOf(readFileSync(FIXTURE_BOARD, 'utf8'))
  const expected = expectedColumns(events)
  // Given: tickets in each state, and one moved building -> merging.
  expect(new Set(expected.values())).toEqual(new Set(COLUMNS))
  const movedTo = (n: number) => events.filter((e) => e.type === 'ticket.moved' && e.payload.number === n).map((e) => e.payload.to)
  const buildingThenMerging = [...expected.keys()].find((n) => {
    const m = movedTo(n)
    return m.at(-1) === 'merging' && m.at(-2) === 'building'
  })
  expect(buildingThenMerging).toBeDefined()

  await page.goto(werk.url)
  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()

  const headings = page.locator('.board section[aria-label] > h2')
  await expect(headings).toHaveCount(5)
  const names = await page.locator('.board section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLUMNS)

  for (const [n, col] of expected) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(page.locator('li[data-ticket]')).toHaveCount(expected.size)
  for (const name of COLUMNS) {
    await expect(column(page, name).locator(`li[data-ticket="${buildingThenMerging}"]`)).toHaveCount(name === 'merging' ? 1 : 0)
  }
})

test('81.2 A ticket card shows a retry count only after more than one retry', async ({ page, werk }) => {
  const events = eventsOf(readFileSync(FIXTURE_BOARD, 'utf8'))
  const retries = new Map<number, number>()
  for (const e of events) if (e.type === 'ticket.retried') retries.set(e.payload.number, (retries.get(e.payload.number) ?? 0) + 1)
  const two = [...retries].find(([, c]) => c === 2)?.[0]
  const one = [...retries].find(([, c]) => c === 1)?.[0]
  expect(two).toBeDefined()
  expect(one).toBeDefined()
  const fields = (n: number) => events.find((e) => e.type === 'ticket.planned' && e.payload.number === n)!.payload as unknown as {
    title: string
    brief: string
    cites: string[]
    checks: string[]
  }

  await openBoard(page, werk.url)
  for (const [n, count] of [
    [two!, 2],
    [one!, 1],
  ] as const) {
    const f = fields(n)
    const c = card(page, n)
    await expect(c.getByRole('link')).toHaveText(f.title)
    if (count === 2) await expect(c).toContainText('2')
    if (count === 2) await expect(c.locator('[data-badge="retries"]')).toContainText('2')
    else await expect(c.locator('[data-badge="retries"]')).toHaveCount(0)
    const text = (await c.innerText()).trim()
    const briefLines = f.brief.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('##'))
    for (const b of briefLines) expect(text).not.toContain(b.replace(/^- \[ \] /, ''))
    for (const id of f.cites) expect(text).not.toContain(`#${id}`)
    for (const ch of f.checks) expect(text).not.toContain(ch)
  }
})

test('81.3 A ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // The fixture's ticket 3 waits on one done ticket and one in building, not ready. Ticket 7 is added to the
  // fixture log here: it is blocked by ticket 1 (done in the fixture) and ticket 3 (ready in the fixture).
  const events = eventsOf(readFileSync(FIXTURE_BOARD, 'utf8'))
  const cols = expectedColumns(events)
  expect(cols.get(1)).toBe('done')
  expect(cols.get(3)).toBe('ready')
  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), planned({ number: 7, title: 'Wait on one done and one ready', blockedBy: [1, 3] }))
  const noBlockers = events.find((e) => e.type === 'ticket.planned' && (e.payload.blockedBy as number[]).length === 0)!.payload.number

  await openBoard(page, werk.url)
  await expect(card(page, 7).locator('[data-badge="blockers"]')).toBeVisible()
  await expect(card(page, 7).locator('[data-badge="blockers"]')).toHaveText(/(^|\D)1(\D|$)/)
  await expect(card(page, noBlockers)).toBeVisible()
  await expect(card(page, noBlockers).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG_BRIEF = [
  '## What to build',
  '',
  'A person opens a ticket from the board and reads the whole slice in a drawer under the columns.',
  'The drawer keeps the board in view, so the person can compare the ticket with the rest of the plan.',
  'The slice shows every paragraph of the What to build section, and every line of the acceptance criteria.',
  'This paragraph is here only to make the brief long enough that a card could not show it all.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] The drawer shows the full slice.',
  '- [ ] The drawer shows the cited cards and the blockers.',
  '- [ ] The columns stay in view above the drawer.',
].join('\n')

test('81.4 A click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  // No fixture ticket has a blocker and two retries together, so ticket 8 is added to the fixture log here.
  appendFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    planned({ number: 8, title: 'Read a ticket in a drawer', cites: ['map-hash', 'map'], blockedBy: [2], brief: LONG_BRIEF }) +
      line('ticket.retried', { number: 8 }) +
      line('ticket.retried', { number: 8 }),
  )
  await openBoard(page, werk.url)
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveCount(0)
  await card(page, 8).getByRole('link').click()

  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  for (const l of LONG_BRIEF.split('\n').filter((x) => x.trim() !== '')) {
    await expect(slice).toContainText(l.replace(/^## /, '').replace(/^- \[ \] /, ''))
  }
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('map-hash')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('map')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')

  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)

  const drawerBox = (await drawer.boundingBox())!
  for (const name of COLUMNS) {
    await expect(column(page, name)).toBeVisible()
    await expect(column(page, name)).toBeInViewport()
    const box = (await column(page, name).boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(drawerBox.y)
  }
})

test('81.5 A click on a cited card id in the drawer opens that card on the map', async ({ page, werk }) => {
  await openBoard(page, werk.url)
  const before = await columnsOnPage(page)
  expect(Object.values(before).flat().length).toBeGreaterThan(0)

  // Ticket 3 of the fixture cites map-hash, a real card on the map with a title and a body.
  await card(page, 3).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await drawer.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()

  const nav = page.getByRole('navigation', { name: 'views' })
  await expect(nav.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'The board' })).toHaveCount(0)
  const open = page.getByTestId('card')
  await expect(open).toHaveAttribute('data-card-id', 'map-hash')
  await expect(open).toContainText('The open card lives in the location hash')
  await expect(open).toContainText('The address bar names the open card.')

  await nav.getByRole('link', { name: 'Board' }).click()
  await expect(page.getByRole('heading', { name: 'The board' })).toBeVisible()
  const names = await page.locator('.board section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLUMNS)
  for (const name of COLUMNS) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(before[name]!.length)
  }
  expect(await columnsOnPage(page)).toEqual(before)
})
