/** Held-out group 81: the ticket board of the fixture project. */
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { appendEvent } from '../src/map/log.ts'
import { expect, test, type Werk } from '../e2e/harness.ts'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const boardLog = (werk: Werk) => join(werk.dir, '.werk', 'board.jsonl')

const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('.board')).toBeVisible()
}

const layout = async (page: Page) => {
  const out: Record<string, string[]> = {}
  for (const name of COLUMNS) out[name] = await column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  return out
}

const plan = (werk: Werk, number: number, fields: { title: string; cites: string[]; blockedBy: number[]; brief: string }) =>
  appendEvent(boardLog(werk), { type: 'ticket.planned', payload: { number, stories: [], touches: ['map view'], checks: ['make test', 'make e2e'], ...fields } }, 'agent')

test('81.1 every fixture ticket sits in the column its last event names', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('.board > section[data-column]')).toHaveCount(5)
  expect(await page.locator('.board > section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))).toEqual(COLUMNS)
  expect(await layout(page)).toEqual({ blocked: ['4'], ready: ['3', '6'], building: ['2'], merging: ['5'], done: ['1'] })
  for (const n of [1, 2, 3, 4, 5, 6]) await expect(ticket(page, n)).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page }) => {
  await openBoard(page)
  const two = ticket(page, 2)
  await expect(two.getByRole('link').first()).toHaveText('Draw the map in a browser')
  await expect(two.locator('[data-badge="retries"]')).toHaveText('↻ 2')
  const one = ticket(page, 3)
  await expect(one.getByRole('link').first()).toHaveText('Open a card from the address bar')
  await expect(one.locator('[data-badge="retries"]')).toHaveCount(0)
  for (const t of [two, one]) {
    await expect(t).not.toContainText('What to build')
    await expect(t).not.toContainText('Acceptance criteria')
    await expect(t).not.toContainText('#map')
    await expect(t).not.toContainText('make test')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // The fixture has no ticket blocked by one done and one ready ticket, so the test adds ticket 7: blocked by 1 (done) and 6 (ready).
  plan(werk, 7, { title: 'Wait for a done and a ready ticket', cites: ['map'], blockedBy: [1, 6], brief: '## What to build\n\nA test ticket.' })
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toHaveCount(1)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveText('⛔ 1')
  await expect(ticket(page, 4)).toBeVisible()
  await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG_BRIEF = [
  '## What to build',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the slice: the drawer shows every line of the brief, and it cuts none of them off.`),
  '',
  '## Acceptance criteria',
  '',
  '- [ ] The last line of the long brief is visible in the drawer.',
].join('\n')

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  // The fixture has no ticket with a long brief, cites, a blocker and two retries, so the test adds ticket 8.
  plan(werk, 8, { title: 'A ticket with a long brief', cites: ['map-hash', 'fold'], blockedBy: [2], brief: LONG_BRIEF })
  appendEvent(boardLog(werk), { type: 'ticket.retried', payload: { number: 8 } }, 'agent')
  appendEvent(boardLog(werk), { type: 'ticket.retried', payload: { number: 8 } }, 'agent')
  await openBoard(page)
  await ticket(page, 8).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  expect((await slice.locator('.body').innerText()).replace(/\s+/g, ' ').trim()).toBe(LONG_BRIEF.replace(/\s+/g, ' ').trim())
  await expect(metadata.getByRole('list', { name: 'cited cards' }).getByRole('link')).toHaveText(['#map-hash', '#fold'])
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata.locator('div', { has: page.locator('dt', { hasText: /^retries$/ }) }).locator('dd')).toHaveText('2')
  await expect(metadata.getByRole('list', { name: 'checks' })).toHaveText(/make test.*make e2e/s)
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const name of COLUMNS) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  const before = await layout(page)
  await ticket(page, 3).getByRole('link').first().click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.locator('.board')).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card.locator('.body')).toContainText('The address bar names the open card.')
  await openBoard(page)
  await expect(page.locator('.board > section[data-column]')).toHaveCount(5)
  expect(await layout(page)).toEqual(before)
})
