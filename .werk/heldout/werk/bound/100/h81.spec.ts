/** Held-out steps 81.x: the ticket board view. */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}
const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const columnNames = (page: Page) =>
  page.locator('.board').getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const layout = async (page: Page) => {
  const out: Record<string, string[]> = {}
  for (const c of COLUMNS)
    out[c] = await column(page, c).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  return out
}

// Scenario: A person sees every fixture ticket in the column its last event names
// Given the test project has a board log with tickets in each ticket state
// And one ticket was moved to building and then moved again to merging
// When the person opens the test project in the browser
// And the person switches from the map to the board
// Then the person sees five columns in the order blocked, ready, building, merging, done
// And each ticket appears as one card in the column that its last event names
// And the ticket that moved from building to merging appears only in merging
test('81.1 every fixture ticket shows in the column its last event names', async ({ page }) => {
  await toBoard(page)
  await expect.poll(() => columnNames(page)).toEqual(COLUMNS)
  // Last events of the fixture board log: 1 done, 2 building, 3 ready, 4 blocked, 5 merging, 6 ready.
  const expected: Record<string, number[]> = { blocked: [4], ready: [3, 6], building: [2], merging: [5], done: [1] }
  for (const [name, nums] of Object.entries(expected)) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(nums.length)
    for (const n of nums) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

// Scenario: A ticket card shows a retry count only after more than one retry
test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await toBoard(page)
  // Ticket 2 retried two times, ticket 3 one time.
  await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const card = ticket(page, n)
    await expect(card).not.toContainText('What to build')
    await expect(card).not.toContainText('Acceptance criteria')
    await expect(card).not.toContainText('#map')
    await expect(card).not.toContainText('make test')
    await expect(card).not.toContainText('make e2e')
  }
})

// Scenario: A ticket card counts only the blockers that are not done
test('81.3 the blocker count leaves out done blockers', async ({ page, werk }) => {
  // Ticket 7 is blocked by ticket 1 (done) and ticket 3 (ready).
  const planned = { seq: 18, at: new Date().toISOString(), actor: 'agent', type: 'ticket.planned', payload: { number: 7, title: 'Blocked by a done and a ready ticket', cites: ['map'], blockedBy: [1, 3], stories: [1], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nx' } }
  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), JSON.stringify(planned) + '\n')
  await toBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toBeVisible()
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveText('⛔ 1')
  // Ticket 2 has no blockers.
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

// Scenario: A click on a ticket opens a drawer with the slice and its metadata
test('81.4 a click on a ticket opens a drawer under the board', async ({ page, werk }) => {
  const board = join(werk.dir, '.werk', 'board.jsonl')
  const longBrief =
    '## What to build\n\n' +
    Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the long brief describes one more part of the slice in plain words.`).join('\n\n') +
    '\n\n## Acceptance criteria\n\n- [ ] The last line of the long brief shows in the drawer.'
  const events = [
    { seq: 18, type: 'ticket.planned', payload: { number: 7, title: 'A ticket with a long brief', cites: ['map', 'log'], blockedBy: [2], stories: [1], touches: ['map view'], checks: ['make test', 'make e2e'], brief: longBrief } },
    { seq: 19, type: 'ticket.retried', payload: { number: 7 } },
    { seq: 20, type: 'ticket.retried', payload: { number: 7 } },
  ]
  for (const e of events) appendFileSync(board, JSON.stringify({ ...e, at: new Date().toISOString(), actor: 'agent' }) + '\n')
  await toBoard(page)
  await ticket(page, 7).getByRole('link').click()

  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Paragraph 1 of the long brief')
  await expect(slice).toContainText('Paragraph 12 of the long brief')
  await expect(slice).toContainText('The last line of the long brief shows in the drawer.')
  await expect(metadata.getByRole('list', { name: 'cited cards' }).getByRole('link')).toHaveText(['#map', '#log'])
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText('retries2')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')

  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const boardBox = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height)
  for (const c of COLUMNS) await expect(column(page, c)).toBeVisible()
})

// Scenario: A click on a cited card id in the drawer opens that card on the map
test('81.5 a cited id in the drawer opens the card on the map', async ({ page }) => {
  await toBoard(page)
  await expect(page.locator('li[data-ticket]')).toHaveCount(6)
  const before = await layout(page)
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.locator('.board')).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await toBoard(page)
  await expect.poll(() => columnNames(page)).toEqual(COLUMNS)
  await expect.poll(() => layout(page)).toEqual(before)
})
