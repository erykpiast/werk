import type { Page } from '@playwright/test'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
let seq = 200
const add = (werk: Werk, type: string, payload: unknown) =>
  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), JSON.stringify({ seq: seq++, at: new Date().toISOString(), actor: 'agent', type, payload }) + '\n')
const planned = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
  number: n, title, cites: ['map'], blockedBy: [], stories: [1], touches: ['map view'], checks: ['make test'],
  brief: '## What to build\n\nA thing.\n\n## Acceptance criteria\n\n- [ ] It works.', ...extra,
})

test('81.1 every fixture ticket sits in the column its last event names', async ({ page }) => {
  await toBoard(page)
  const names = await page.getByRole('region').filter({ has: page.locator('li[data-ticket]') }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  const cols = page.locator('[role="region"][aria-label], section[aria-label]')
  const order = await page.getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.split('\n')[0]))
  console.log('regions', order, names, await cols.count())
  for (const c of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, c)).toBeVisible()
  const boxes = await Promise.all(['blocked', 'ready', 'building', 'merging', 'done'].map(async (c) => (await column(page, c).boundingBox())!.x))
  expect(boxes).toEqual([...boxes].sort((a, b) => a - b))
  const expected: [string, number[]][] = [['blocked', [4]], ['ready', [3, 6]], ['building', [2]], ['merging', [5]], ['done', [1]]]
  for (const [name, ns] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(ns.length)
    for (const n of ns) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await toBoard(page)
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    await expect(ticket(page, n)).not.toContainText('What to build')
    await expect(ticket(page, n)).not.toContainText('#map')
    await expect(ticket(page, n)).not.toContainText('make test')
  }
})

test('81.3 a card counts only blockers that are not done', async ({ page, werk }) => {
  add(werk, 'ticket.planned', planned(7, 'Waits on one done and one ready', { blockedBy: [1, 6] }))
  await toBoard(page)
  await expect(ticket(page, 6)).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toHaveCount(1)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const longBrief = '## What to build\n\n' + 'A long paragraph about the drawer that the person reads. '.repeat(20) + 'THE END OF THE BRIEF.\n\n## Acceptance criteria\n\n- [ ] The drawer shows all of it.'

test('81.4 a click opens a drawer under the board with the slice and its metadata', async ({ page, werk }) => {
  add(werk, 'ticket.planned', planned(7, 'A ticket with a long brief', { cites: ['map-hash', 'fold'], blockedBy: [2], checks: ['make test', 'make e2e'], brief: longBrief }))
  add(werk, 'ticket.retried', { number: 7 })
  add(werk, 'ticket.retried', { number: 7 })
  await toBoard(page)
  await ticket(page, 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('THE END OF THE BRIEF.')
  await expect(slice).toContainText('The drawer shows all of it.')
  await expect(meta.getByRole('list', { name: 'cited cards' }).getByRole('link')).toHaveText(['#map-hash', '#fold'])
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText('retries2')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const l = (await slice.boundingBox())!, r = (await meta.boundingBox())!
  expect(l.x + l.width).toBeLessThanOrEqual(r.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const c of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, c)).toBeVisible()
})

test('81.5 a cited id in the drawer opens that card on the map, and back to the board', async ({ page }) => {
  await toBoard(page)
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await expect(page.getByRole('region', { name: 'ready', exact: true })).toHaveCount(0)
  await toBoard(page)
  const expected: [string, number[]][] = [['blocked', [4]], ['ready', [3, 6]], ['building', [2]], ['merging', [5]], ['done', [1]]]
  for (const [name, ns] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(ns.length)
    for (const n of ns) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
})
