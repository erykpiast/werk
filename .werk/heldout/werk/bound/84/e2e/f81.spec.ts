/** Feature 81: the ticket board. */
import type { NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { accepted, proposed } from '../../src/test/map-events.ts'
import { expect, open, test, type Proj } from './harness.ts'
import type { Page } from '@playwright/test'

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the long brief explains one more part of the work.`).join('\n')
const t = (number: number, title: string, f: Partial<TicketFields> = {}): NewBoardEvent => ({
  type: 'ticket.planned',
  payload: { number, title, cites: [], blockedBy: [], stories: [1], touches: ['map view'], checks: ['make test'], brief: `## What to build\n\nBuild ${title}.`, ...f },
})
const moved = (number: number, to: 'blocked' | 'ready' | 'building' | 'merging' | 'done', reason?: string): NewBoardEvent => ({
  type: 'ticket.moved',
  payload: { number, to, ...(reason && { reason }) },
})
const retried = (number: number): NewBoardEvent => ({ type: 'ticket.retried', payload: { number } })

function seedBoard(proj: Proj) {
  proj.seed(
    proposed('map-card', { title: 'The map card', body: 'The body of the map card.' }),
    accepted('map-card'),
    proposed('other-card', { title: 'Another card' }),
    accepted('other-card'),
  )
  proj.board(
    t(1, 'Moved twice'),
    t(2, 'Draw the map', { cites: ['map-card', 'other-card'], blockedBy: [5], brief: `## What to build\n\n${LONG}\n\n## Acceptance criteria\n\n- [ ] The last line is LAST-LINE.`, checks: ['make test', 'make e2e'] }),
    t(3, 'Blocked by two', { blockedBy: [5, 6] }),
    t(4, 'Waits for a fix'),
    t(5, 'All done'),
    t(6, 'Ready to go'),
    moved(1, 'building'),
    moved(1, 'merging'),
    moved(2, 'building'),
    retried(2),
    retried(2),
    moved(4, 'blocked', 'blocker 9 is not a ticket in the set'),
    moved(5, 'done'),
    retried(6),
  )
}
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
async function toBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('.board')).toBeVisible()
}
const EXPECTED: [string, number[]][] = [
  ['blocked', [4]],
  ['ready', [3, 6]],
  ['building', [2]],
  ['merging', [1]],
  ['done', [5]],
]

test('81.1 a person sees every fixture ticket in the column its last event names', async ({ page, proj }) => {
  seedBoard(proj)
  await open(page, proj)
  await toBoard(page)
  const names = await page.locator('.board > section').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  for (const [name, numbers] of EXPECTED) {
    const cards = column(page, name).locator('li[data-ticket]')
    await expect(cards).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(page.locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'merging').locator('li[data-ticket="1"]')).toHaveCount(1)
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page, proj }) => {
  seedBoard(proj)
  await open(page, proj)
  await toBoard(page)
  await expect(ticket(page, 2)).toContainText('Draw the map')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 6)).toContainText('Ready to go')
  await expect(ticket(page, 6).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 6]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('Line 1 of the long brief')
    expect(text).not.toContain('map-card')
    expect(text).not.toContain('make test')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, proj }) => {
  seedBoard(proj)
  await open(page, proj)
  await toBoard(page)
  await expect(ticket(page, 3).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 3).locator('[data-badge="blockers"]')).not.toContainText('2')
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, proj }) => {
  seedBoard(proj)
  await open(page, proj)
  await toBoard(page)
  await ticket(page, 2).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  const box = (await drawer.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(board.y + board.height)
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Line 1 of the long brief')
  await expect(slice).toContainText('Line 30 of the long brief')
  await expect(slice).toContainText('LAST-LINE')
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  await expect(metadata).toContainText('#map-card')
  await expect(metadata).toContainText('#other-card')
  await expect(metadata).toContainText('All done')
  await expect(metadata).toContainText('retries2')
  await expect(metadata).toContainText('make e2e')
  for (const [name] of EXPECTED) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page, proj }) => {
  seedBoard(proj)
  await open(page, proj)
  await toBoard(page)
  await ticket(page, 2).getByRole('link').click()
  await page.getByRole('complementary', { name: 'metadata' }).getByRole('link', { name: '#map-card' }).click()
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-card')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The map card')
  await expect(card).toContainText('The body of the map card.')
  await expect(page.locator('.board')).toHaveCount(0)
  await toBoard(page)
  for (const [name, numbers] of EXPECTED) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
})
