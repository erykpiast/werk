/** Held-out steps 81.1 - 81.5: the board view. */
import { expect, test } from '../../e2e/harness.ts'
import { appendBoard, column, moved, openBoard, planned, replaceBoard, ticket } from './helpers.ts'

test('81.1 every fixture ticket shows in the column its last event names', async ({ page, werk }) => {
  await openBoard(page, werk)
  await expect(page.locator('section.column h2')).toHaveText([/^blocked/, /^ready/, /^building/, /^merging/, /^done/])
  const expected: [string, number[]][] = [['blocked', [4]], ['ready', [3, 6]], ['building', [2]], ['merging', [5]], ['done', [1]]]
  for (const [name, ns] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(ns.length)
    for (const n of ns) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page, werk }) => {
  await openBoard(page, werk)
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toHaveText(/2/)
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('Acceptance criteria')
    expect(text).not.toContain('make test')
    expect(text).not.toMatch(/#map\b/)
  }
})

test('81.3 a blocker count counts only blockers that are not done', async ({ page, werk }) => {
  replaceBoard(
    werk.dir,
    planned({ number: 1, title: 'Done blocker' }),
    planned({ number: 2, title: 'Ready blocker' }),
    planned({ number: 3, title: 'Blocked ticket', blockedBy: [1, 2] }),
    planned({ number: 4, title: 'Free ticket' }),
    moved(1, 'building'),
    moved(1, 'merging'),
    moved(1, 'done'),
  )
  await openBoard(page, werk)
  await expect(column(page, 'ready').locator('li[data-ticket="2"]')).toHaveCount(1)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(ticket(page, 3).locator('[data-badge="blockers"]')).toHaveText(/1/)
  await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the long brief says what the drawer must show in full.`).join('\n\n')

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  appendBoard(
    werk.dir,
    planned({ number: 7, title: 'A ticket with a long brief', cites: ['map-hash', 'map'], blockedBy: [2], checks: ['make test', 'make e2e'], brief: `## What to build\n\n${LONG}\n\n## Acceptance criteria\n\n- [ ] END-OF-BRIEF` }),
    { type: 'ticket.retried', payload: { number: 7 } },
    { type: 'ticket.retried', payload: { number: 7 } },
  )
  await openBoard(page, werk)
  await ticket(page, 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height - 1)
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Line 1 of the long brief')
  await expect(slice).toContainText('Line 30 of the long brief')
  await expect(slice).toContainText('END-OF-BRIEF')
  expect((await slice.boundingBox())!.x + (await slice.boundingBox())!.width).toBeLessThanOrEqual((await meta.boundingBox())!.x + 1)
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText(/retries\s*2/)
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page, werk }) => {
  await openBoard(page, werk)
  await expect(ticket(page, 3)).toBeVisible()
  const before: Record<string, string[]> = {}
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) before[name] = await column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('region', { name: 'blocked', exact: true })).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card).toContainText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('section.column h2')).toHaveText([/^blocked/, /^ready/, /^building/, /^merging/, /^done/])
  for (const name of Object.keys(before)) {
    await expect.poll(() => column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))).toEqual(before[name])
  }
})
