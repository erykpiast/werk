/** Held-out steps 81.1 to 81.5: the board of the test project. */
import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/harness.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { appendBoard, boardEvents } from './lib.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}
const numbersIn = (page: Page, name: string) =>
  column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))

test('81.1 every fixture ticket shows in the column its last event names', async ({ page, werk }) => {
  const events = boardEvents(werk.dir)
  // The test project has tickets in each state, and one moved to building and then to merging.
  const last = new Map<number, string>()
  for (const e of events) {
    if (e.type === 'ticket.planned' && !last.has(e.payload.number)) last.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') last.set(e.payload.number, e.payload.to)
  }
  expect(new Set(last.values())).toEqual(new Set(['blocked', 'ready', 'building', 'merging', 'done']))
  const movedTwice = [...last.keys()].find((n) => {
    const moves = events.flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
    return moves.at(-2) === 'building' && moves.at(-1) === 'merging'
  })
  expect(movedTwice).toBeDefined()

  await expect(page.getByRole('navigation', { name: 'views' })).toBeVisible()
  await expect(page.locator('.board')).toHaveCount(0)
  await toBoard(page)
  await expect(page.locator('.board section[data-column]')).toHaveCount(5)
  const names = await page.locator('.board section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  for (const [n, col] of last) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toBeVisible()
  }
  await expect(page.locator(`li[data-ticket="${movedTwice}"]`)).toHaveCount(1)
  await expect(column(page, 'merging').locator(`li[data-ticket="${movedTwice}"]`)).toBeVisible()
  await expect(column(page, 'building').locator(`li[data-ticket="${movedTwice}"]`)).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page, werk }) => {
  const retries = (n: number) => boardEvents(werk.dir).filter((e) => e.type === 'ticket.retried' && e.payload.number === n).length
  expect(retries(2)).toBe(2)
  expect(retries(3)).toBe(1)
  await toBoard(page)
  await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toHaveText(/2/)
  await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const t = ticket(page, n)
    await expect(t).not.toContainText('What to build')
    await expect(t).not.toContainText('Acceptance criteria')
    await expect(t).not.toContainText('make test')
    await expect(t).not.toContainText('make e2e')
    await expect(t).not.toContainText('#map')
  }
  await expect(ticket(page, 2)).not.toContainText('The server sends the fold')
  await expect(ticket(page, 3)).not.toContainText('location hash')
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // A ticket blocked by ticket 1 (done) and ticket 6 (ready).
  appendBoard(werk.dir, {
    type: 'ticket.planned',
    payload: { number: 7, title: 'Wait for two tickets', cites: ['map'], blockedBy: [1, 6], stories: [], touches: ['x'], checks: ['make test'], brief: 'b' },
  })
  const b = foldBoard(boardEvents(werk.dir))
  const col = (n: number) => b.columns.find((c) => c.tickets.some((t) => t.number === n))?.name
  expect([col(1), col(6)]).toEqual(['done', 'ready'])
  await toBoard(page)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveText(/(^|\D)1$/)
  // Ticket 6 has no blockers.
  await expect(ticket(page, 6)).toBeVisible()
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const brief = '## What to build\n\n' + 'A long paragraph about the drawer. '.repeat(30) + 'THE-END-OF-THE-BRIEF\n\n## Acceptance criteria\n\n- The drawer shows it all.'
  appendBoard(
    werk.dir,
    { type: 'ticket.planned', payload: { number: 7, title: 'A long ticket', cites: ['map-hash', 'fold'], blockedBy: [2], stories: [1], touches: ['x'], checks: ['make test', 'make e2e'], brief } },
    { type: 'ticket.retried', payload: { number: 7 } },
    { type: 'ticket.retried', payload: { number: 7 } },
  )
  await toBoard(page)
  await ticket(page, 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('THE-END-OF-THE-BRIEF')
  await expect(slice).toContainText('The drawer shows it all.')
  await expect(metadata).toContainText('#map-hash')
  await expect(metadata).toContainText('#fold')
  await expect(metadata).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata).toContainText('make test')
  await expect(metadata).toContainText('make e2e')
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await toBoard(page)
  const before: Record<string, number[]> = {}
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) before[name] = await numbersIn(page, name)
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('region', { name: 'blocked', exact: true })).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText(/\S{10,}/)
  await toBoard(page)
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect.poll(() => numbersIn(page, name)).toEqual(before[name])
})
