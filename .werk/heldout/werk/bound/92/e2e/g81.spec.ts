import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}
/** Adds board events to the test project's board log, as the Given of a step. */
const addBoard = (dir: string, events: object[]) => {
  const path = join(dir, '.werk', 'board.jsonl')
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  let seq = JSON.parse(lines.at(-1)!).seq as number
  appendFileSync(path, events.map((e) => JSON.stringify({ seq: ++seq, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e }) + '\n').join(''))
}
const planned = (number: number, title: string, extra: object = {}) => ({
  type: 'ticket.planned',
  payload: { number, title, cites: [], blockedBy: [], stories: [1], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nx', ...extra },
})

test('81.1 every fixture ticket sits in the column its last event names', async ({ page, werk }) => {
  // Expected columns computed from the last move of each ticket in the fixture log.
  const events = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const last = new Map<number, string>()
  for (const e of events) {
    if (e.type === 'ticket.planned' && !last.has(e.payload.number)) last.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') last.set(e.payload.number, e.payload.to)
  }
  const states = new Set(last.values())
  expect(states.size).toBe(5) // tickets in each state
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect.poll(() => page.locator('section.column').evaluateAll((s) => s.map((x) => x.getAttribute('aria-label')))).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  for (const [n, col] of last) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved building -> merging.
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 retry count shows only after more than one retry', async ({ page }) => {
  await toBoard(page)
  // Fixture: ticket 2 retried twice, ticket 3 retried once.
  await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toHaveText(/2/)
  await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = (await ticket(page, n).innerText())
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('make test')
    expect(text).not.toContain('#map')
  }
})

test('81.3 blocker count counts only blockers not done', async ({ page, werk }) => {
  // Ticket 6 blocked by ticket 1 (done) and ticket 3 (ready); ticket 7 has no blockers.
  addBoard(werk.dir, [planned(6, 'Blocked by done and ready', { blockedBy: [1, 3] }), planned(7, 'No blockers')])
  await toBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveText(/1/)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const brief = '## What to build\n\n' + 'The drawer shows the whole slice of this ticket. '.repeat(30) + 'END-OF-BRIEF\n\n## Acceptance criteria\n\n- [ ] It works.'
  addBoard(werk.dir, [
    planned(8, 'A ticket with a long brief', { cites: ['map', 'log'], blockedBy: [2], brief, checks: ['make test', 'make e2e'] }),
    { type: 'ticket.retried', payload: { number: 8 } },
    { type: 'ticket.retried', payload: { number: 8 } },
  ])
  await toBoard(page)
  await ticket(page, 8).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('END-OF-BRIEF')
  await expect(slice).toContainText('It works.')
  const l = (await slice.boundingBox())!, r = (await meta.boundingBox())!
  expect(l.x + l.width).toBeLessThanOrEqual(r.x)
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#log')
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText('retries2')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeVisible()
})

test('81.5 a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await toBoard(page)
  await expect(ticket(page, 3)).toBeVisible()
  const before = await page.locator('li[data-ticket]').evaluateAll((l) => l.map((x) => `${x.closest('section')!.getAttribute('aria-label')}:${x.getAttribute('data-ticket')}`))
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  const log = readFileSync(join(import.meta.dirname, '../../e2e/fixture-project/.werk/log.jsonl'), 'utf8')
  const body = log.split('\n').filter(Boolean).map((x) => JSON.parse(x)).find((e) => e.payload?.id === 'map-hash' && e.payload?.body)?.payload.body
  if (body) await expect(card.locator('.body')).toContainText(body.split('\n')[0].replace(/[#*`]/g, '').trim().slice(0, 30))
  else await expect(card.locator('.body')).toBeVisible()
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect.poll(() => page.locator('section.column').evaluateAll((s) => s.map((x) => x.getAttribute('aria-label')))).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  await expect.poll(() => page.locator('li[data-ticket]').evaluateAll((l) => l.map((x) => `${x.closest('section')!.getAttribute('aria-label')}:${x.getAttribute('data-ticket')}`))).toEqual(before)
})
