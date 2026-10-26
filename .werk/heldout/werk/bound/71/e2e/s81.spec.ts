import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/harness.ts'
import { appendBoard } from './util.ts'

const COLS = ['blocked', 'ready', 'building', 'merging', 'done']
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(column(page, 'done')).toBeVisible()
}
const snapshot = async (page: Page) => {
  const out: Record<string, string[]> = {}
  for (const c of COLS) out[c] = await column(page, c).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  return out
}

test('81.1 every fixture ticket sits in the column its last event names', async ({ page, werk }) => {
  const events = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const where = new Map<number, string>()
  const moves = new Map<number, string[]>()
  for (const e of events) {
    if (e.type === 'ticket.planned') where.set(e.payload.number, where.get(e.payload.number) ?? 'ready')
    if (e.type === 'ticket.moved') {
      where.set(e.payload.number, e.payload.to)
      moves.set(e.payload.number, [...(moves.get(e.payload.number) ?? []), e.payload.to])
    }
  }
  expect(new Set(where.values())).toEqual(new Set(COLS))
  const mover = [...moves].find(([, m]) => m.join() === 'building,merging')
  expect(mover).toBeDefined()
  await expect(page.getByRole('list', { name: 'map' })).toBeVisible()
  await openBoard(page)
  expect(await page.locator('section.column h2').evaluateAll((hs) => hs.map((h) => h.childNodes[0]!.textContent!.trim()))).toEqual(COLS)
  for (const [n, col] of where) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  await expect(column(page, 'building').locator(`li[data-ticket="${mover![0]}"]`)).toHaveCount(0)
  await expect(column(page, 'merging').locator(`li[data-ticket="${mover![0]}"]`)).toHaveCount(1)
})

test('81.2 a ticket card shows a retry count only after more than one retry', async ({ page }) => {
  await openBoard(page)
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const [n, brief, cite] of [
    [2, 'The server sends the fold', 'map'],
    [3, 'A person opens a card', 'map-hash'],
  ] as const) {
    await expect(ticket(page, n)).not.toContainText(brief)
    await expect(ticket(page, n)).not.toContainText('Acceptance')
    await expect(ticket(page, n)).not.toContainText(`#${cite}`)
    await expect(ticket(page, n)).not.toContainText('make test')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  appendBoard(werk, [
    {
      type: 'ticket.planned',
      payload: { number: 6, title: 'Blocked by a done and a ready ticket', cites: ['map'], blockedBy: [1, 3], stories: [1], touches: ['map view'], checks: ['make test'], brief: 'Brief.' },
    },
  ])
  await page.reload()
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toHaveText(/(^|\D)1$/)
  await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG_BRIEF = ['## What to build', '', ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the long brief explains one more part of the slice.`), '', '## Acceptance criteria', '', '- [ ] The last line of the brief is here.'].join('\n')

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  appendBoard(werk, [
    { type: 'ticket.planned', payload: { number: 6, title: 'The long ticket', cites: ['map', 'map-hash'], blockedBy: [2], stories: [1], touches: ['map view'], checks: ['make test', 'make e2e'], brief: LONG_BRIEF } },
    { type: 'ticket.retried', payload: { number: 6 } },
    { type: 'ticket.retried', payload: { number: 6 } },
  ])
  await page.reload()
  await openBoard(page)
  await ticket(page, 6).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  expect(await slice.locator('.body').evaluate((e) => e.textContent)).toBe(LONG_BRIEF)
  await expect(meta.getByRole('link', { name: '#map', exact: true })).toBeVisible()
  await expect(meta.getByRole('link', { name: '#map-hash' })).toBeVisible()
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText('retries2')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const l = (await slice.boundingBox())!
  const r = (await meta.boundingBox())!
  expect(l.x + l.width).toBeLessThanOrEqual(r.x)
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const c of COLS) await expect(column(page, c)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  const before = await snapshot(page)
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  const c = page.getByTestId('card')
  await expect(c).toHaveAttribute('data-card-id', 'map-hash')
  await expect(c.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(c).toContainText('The address bar names the open card.')
  await openBoard(page)
  expect(await snapshot(page)).toEqual(before)
})
