/** Held-out steps 81.1 to 81.5: the board of the test project. */
import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/harness.ts'
import { appendBoard, column, openBoard, ticket } from './helpers.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const columnNumbers = (page: Page) =>
  page.locator('[data-column]').evaluateAll((cols) =>
    cols.map((c) => [c.getAttribute('data-column'), [...c.querySelectorAll('li[data-ticket]')].map((li) => Number(li.getAttribute('data-ticket')))]),
  )

const planned = (number: number, fields: Record<string, unknown>) => ({
  type: 'ticket.planned',
  payload: { number, title: `Ticket ${number}`, cites: [], blockedBy: [], stories: [1], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nA thing.', ...fields },
})

test('81.1 every fixture ticket sits in the column its last event names', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('[data-column]')).toHaveCount(5)
  const cols = await page.locator('[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
  expect(cols).toEqual(COLUMNS)
  const expected: Record<string, number[]> = { blocked: [4], ready: [3, 6], building: [2], merging: [5], done: [1] }
  for (const [name, numbers] of Object.entries(expected)) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 went building -> merging (ticket 1 went on to done).
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await openBoard(page)
  // Fixture: ticket 2 retried two times, ticket 3 one time.
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const [n, brief, cite] of [
    [2, 'The server sends the fold', '#map'],
    [3, 'A person opens a card', '#map-hash'],
  ] as const) {
    const text = (await ticket(page, n).innerText()) ?? ''
    expect(text).not.toContain(brief)
    expect(text).not.toContain(cite)
    expect(text).not.toContain('make test')
    expect(text).not.toContain('make e2e')
  }
})

test('81.3 a blocker count counts only the blockers that are not done', async ({ page, werk }) => {
  // Ticket 7 is blocked by ticket 1 (done) and ticket 6 (ready).
  appendBoard(werk.dir, [planned(7, { title: 'Blocked by a done and a ready ticket', blockedBy: [1, 6] })])
  await openBoard(page)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toContainText('1')
  // Ticket 2 has no blockers.
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the long brief explains one more part of the work.`).join(' ')
  const brief = `## What to build\n\n${long}\n\n## Acceptance criteria\n\n- [ ] The last part works.`
  appendBoard(werk.dir, [
    planned(8, { title: 'A ticket with a long brief', cites: ['map', 'map-hash'], blockedBy: [3], checks: ['make test', 'make e2e'], brief }),
    { type: 'ticket.retried', payload: { number: 8 } },
    { type: 'ticket.retried', payload: { number: 8 } },
  ])
  await openBoard(page)
  await ticket(page, 8).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Sentence 30 of the long brief')
  await expect(slice).toContainText('Sentence 1 of the long brief')
  await expect(slice).toContainText('The last part works.')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Open a card from the address bar')
  await expect(metadata).toContainText('retries2')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')

  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const d = (await drawer.boundingBox())!
  for (const name of COLUMNS) {
    const col = column(page, name)
    await expect(col).toBeVisible()
    const box = (await col.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(d.y)
  }
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('li[data-ticket]')).toHaveCount(6)
  const before = await columnNumbers(page)
  await ticket(page, 3).getByRole('link').first().click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await expect(page.locator('[data-column]')).toHaveCount(0)

  await openBoard(page)
  await expect(page.locator('[data-column]')).toHaveCount(5)
  expect(await columnNumbers(page)).toEqual(before)
})
