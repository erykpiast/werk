import type { Page } from '@playwright/test'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const COLS = ['blocked', 'ready', 'building', 'merging', 'done']

let seq = 100
function addBoard(dir: string, events: object[]) {
  const lines = events.map((e) => JSON.stringify({ seq: seq++, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e }) + '\n').join('')
  appendFileSync(join(dir, '.werk', 'board.jsonl'), lines)
}
const planned = (number: number, title: string, extra: object = {}) => ({
  type: 'ticket.planned',
  payload: { number, title, cites: [], blockedBy: [], stories: [1], touches: ['x'], checks: ['make test'], brief: 'brief ' + title, ...extra },
})
async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

test('81.1 every fixture ticket in the column its last event names', async ({ page }) => {
  // Fixture: 1 done, 2 building, 3 ready, 4 blocked, 5 building -> merging.
  await openBoard(page)
  await expect(page.locator('section.column')).toHaveCount(5)
  const names = await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLS)
  const expected: Record<string, number[]> = { blocked: [4], ready: [3], building: [2], merging: [5], done: [1] }
  for (const [name, numbers] of Object.entries(expected)) {
    const items = column(page, name).locator('li[data-ticket]')
    await expect(items).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 retry count only after more than one retry', async ({ page }) => {
  await openBoard(page)
  // ticket 2 retried twice, ticket 3 once.
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('make test')
    expect(text).not.toContain('#map')
    expect(text).not.toContain('map-hash')
  }
})

test('81.3 a blocker count counts only blockers that are not done', async ({ page, werk }) => {
  addBoard(werk.dir, [planned(6, 'Ready blocker'), planned(7, 'Blocked by two', { blockedBy: [1, 6] })])
  await page.goto(werk.url)
  await openBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toHaveCount(1)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and metadata', async ({ page, werk }) => {
  const long = '## What to build\n\n' + 'This is a long brief sentence. '.repeat(30) + 'END-OF-BRIEF\n\n## Acceptance criteria\n\n- [ ] it works.'
  addBoard(werk.dir, [
    planned(8, 'Long ticket', { brief: long, cites: ['map-hash', 'fold'], blockedBy: [3], checks: ['make test', 'make e2e'] }),
    { type: 'ticket.retried', payload: { number: 8 } },
    { type: 'ticket.retried', payload: { number: 8 } },
  ])
  await page.goto(werk.url)
  await openBoard(page)
  await ticket(page, 8).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('END-OF-BRIEF')
  await expect(slice).toContainText('it works.')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#fold')
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Open a card from the address bar')
  await expect(meta).toContainText(/retries\s*2/)
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const s = (await slice.boundingBox())!
  const m = (await meta.boundingBox())!
  expect(s.x + s.width).toBeLessThanOrEqual(m.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const c of COLS) await expect(column(page, c)).toBeVisible()
})

test('81.5 a click on a cited card id opens that card on the map, and back', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('li[data-ticket]')).toHaveCount(5)
  const before: Record<string, string[]> = {}
  for (const c of COLS) before[c] = await column(page, c).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.locator('section.column')).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card).toContainText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await openBoard(page)
  await expect(page.locator('section.column')).toHaveCount(5)
  await expect(page.locator('li[data-ticket]')).toHaveCount(5)
  for (const c of COLS) {
    const now = await column(page, c).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
    expect(now).toEqual(before[c])
  }
})
