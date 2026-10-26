import { expect, real, test, type Page } from './harness.ts'

const planned = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'ticket.planned',
  payload: {
    number,
    title,
    cites: [],
    blockedBy: [],
    stories: [1],
    touches: ['map view'],
    checks: ['make test'],
    brief: `## What to build\n\nBuild ticket ${number}.\n\n## Acceptance criteria\n\n- [ ] It works.`,
    ...extra,
  },
})
const moved = (number: number, to: string, reason?: string) => ({ type: 'ticket.moved', payload: { number, to, ...(reason && { reason }) } })
const retried = (number: number) => ({ type: 'ticket.retried', payload: { number } })

const LONG_BRIEF =
  '## What to build\n\n' +
  'The board draws one column per state, and one card per ticket. '.repeat(8) +
  '\n\n## Acceptance criteria\n\n- [ ] Each ticket shows in the column of its last event.\n- [ ] THE-END-OF-THE-BRIEF'

const board = [
  planned(1, 'Blocked ticket', { blockedBy: [] }),
  planned(2, 'Ready ticket'),
  planned(3, 'Building ticket'),
  planned(4, 'Merging ticket'),
  planned(5, 'Done ticket'),
  planned(6, 'Waits on two', { blockedBy: [5, 2] }),
  planned(7, 'The drawer ticket', { brief: LONG_BRIEF, cites: ['board-card', 'map-card'], blockedBy: [2], checks: ['make test', 'make e2e'] }),
  moved(1, 'blocked', 'blocked_by: a blocker is not in the set'),
  moved(3, 'building'),
  moved(4, 'building'),
  moved(4, 'merging'),
  moved(5, 'building'),
  moved(5, 'merging'),
  moved(5, 'done'),
  retried(2),
  retried(2),
  retried(3),
  retried(7),
  retried(7),
]
const log = [...real('board-card', 'The board card', { body: 'The board shows the tickets.' }), ...real('map-card', 'The map card', { body: 'The map shows the cards.' })]

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const where = { 1: 'blocked', 2: 'ready', 3: 'building', 4: 'merging', 5: 'done' } as const

const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('section.column').first()).toBeVisible()
}
const columnNames = (page: Page) => page.locator('[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
const ticketsByColumn = (page: Page) =>
  page.locator('[data-column]').evaluateAll((els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute('data-column'), [...e.querySelectorAll('[data-ticket]')].map((t) => Number(t.getAttribute('data-ticket')))])),
  )

test('81.1 a person sees every fixture ticket in the column its last event names', async ({ page, boot }) => {
  await boot({ log, board })
  await openBoard(page)
  expect(await columnNames(page)).toEqual(COLUMNS)
  const cols = await ticketsByColumn(page)
  for (const [n, col] of Object.entries(where)) {
    expect(cols[col]).toContain(Number(n))
    const all = Object.values(cols).flat().filter((x) => x === Number(n))
    expect(all.length).toBe(1)
  }
  expect(cols.merging).toContain(4)
  expect(cols.building).not.toContain(4)
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page, boot }) => {
  await boot({ log, board })
  await openBoard(page)
  const two = page.locator('li.ticket[data-ticket="2"]')
  const one = page.locator('li.ticket[data-ticket="3"]')
  await expect(two).toContainText('Ready ticket')
  await expect(two).toContainText('2')
  await expect(two.locator('[data-badge="retries"]')).toContainText('2')
  await expect(one).toContainText('Building ticket')
  await expect(one.locator('[data-badge="retries"]')).toHaveCount(0)
  for (const t of [two, one]) {
    await expect(t).not.toContainText('What to build')
    await expect(t).not.toContainText('make test')
    await expect(t).not.toContainText('Build ticket')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, boot }) => {
  await boot({ log, board })
  await openBoard(page)
  const blocked = page.locator('li.ticket[data-ticket="6"]')
  await expect(blocked.locator('[data-badge="blockers"]')).toContainText('1')
  await expect(page.locator('li.ticket[data-ticket="2"] [data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, boot }) => {
  await boot({ log, board })
  await openBoard(page)
  await page.locator('li.ticket[data-ticket="7"] a').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  await expect(slice).toContainText('The board draws one column per state')
  await expect(slice).toContainText('THE-END-OF-THE-BRIEF')
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(meta).toContainText('#board-card')
  await expect(meta).toContainText('#map-card')
  await expect(meta).toContainText('Ready ticket')
  await expect(meta).toContainText('2')
  await expect(meta).toContainText('make e2e')
  const s = await slice.boundingBox()
  const m = await meta.boundingBox()
  expect(s!.x).toBeLessThan(m!.x)
  const boardBox = await page.locator('.board').boundingBox()
  const drawerBox = await drawer.boundingBox()
  expect(drawerBox!.y).toBeGreaterThanOrEqual(boardBox!.y + boardBox!.height - 1)
  for (const c of COLUMNS) await expect(page.locator(`[data-column="${c}"]`)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page, boot }) => {
  await boot({ log, board })
  await openBoard(page)
  const before = await ticketsByColumn(page)
  await page.locator('li.ticket[data-ticket="7"] a').click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('link', { name: '#map-card' }).click()
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map-card')
  await expect(detail).toContainText('The map card')
  await expect(detail).toContainText('The map shows the cards.')
  await openBoard(page)
  expect(await columnNames(page)).toEqual(COLUMNS)
  expect(await ticketsByColumn(page)).toEqual(before)
})
