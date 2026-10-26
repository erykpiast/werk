/** Held-out steps 81.1–81.5: the ticket board in a browser. */
import type { Page } from '@playwright/test'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']

const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket]').first()).toBeVisible()
}

let seq = 1000
const append = (werk: Werk, type: string, payload: unknown) =>
  appendFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    JSON.stringify({ seq: seq++, at: new Date().toISOString(), actor: 'agent', type, payload }) + '\n',
  )
const plan = (werk: Werk, number: number, title: string, extra: Record<string, unknown> = {}) =>
  append(werk, 'ticket.planned', {
    number,
    title,
    cites: [],
    blockedBy: [],
    stories: [],
    touches: ['board'],
    checks: ['make test'],
    brief: `## What to build\n\n${title}.\n\n## Acceptance criteria\n\n- [ ] It works.`,
    ...extra,
  })

test('81.1 every fixture ticket shows in the column its last event names', async ({ page }) => {
  await openBoard(page)
  const names = await page.locator('section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLUMNS)
  const expected: [string, number[]][] = [
    ['blocked', [4]],
    ['ready', [3, 6]],
    ['building', [2]],
    ['merging', [5]],
    ['done', [1]],
  ]
  for (const [name, numbers] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await openBoard(page)
  // Ticket 2 retried two times, ticket 3 one time.
  await expect(ticket(page, 2)).toContainText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3)).toContainText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = await ticket(page, n).innerText()
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('The server sends the fold')
    expect(text).not.toContain('A person opens a card')
    expect(text).not.toContain('#map')
    expect(text).not.toContain('make test')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  plan(werk, 7, 'A ready blocker')
  plan(werk, 8, 'A ticket with two blockers', { blockedBy: [1, 7] })
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="7"]')).toHaveCount(1)
  await expect(ticket(page, 8).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 8).locator('[data-badge="blockers"]')).not.toContainText('2')
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toHaveCount(0)
})

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the long brief explains one more part of the slice.`).join('\n')

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  plan(werk, 9, 'A ticket with a long brief', {
    cites: ['map', 'log'],
    blockedBy: [3],
    checks: ['make test', 'make e2e'],
    brief: `## What to build\n\n${LONG}\n\n## Acceptance criteria\n\n- [ ] The last line shows.`,
  })
  append(werk, 'ticket.retried', { number: 9 })
  append(werk, 'ticket.retried', { number: 9 })
  await openBoard(page)
  await ticket(page, 9).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Line 1 of the long brief')
  await expect(slice).toContainText('Line 30 of the long brief')
  await expect(slice).toContainText('The last line shows.')
  await expect(metadata).toContainText('#map')
  await expect(metadata).toContainText('#log')
  await expect(metadata).toContainText('Open a card from the address bar')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata).toContainText('make e2e')
  const s = (await slice.boundingBox())!
  const m = (await metadata.boundingBox())!
  expect(s.x + s.width).toBeLessThanOrEqual(m.x)
  const d = (await drawer.boundingBox())!
  for (const name of COLUMNS) {
    await expect(column(page, name)).toBeVisible()
    const c = (await column(page, name).boundingBox())!
    expect(c.y).toBeLessThan(d.y)
  }
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  const before: Record<string, string[]> = {}
  for (const name of COLUMNS) {
    before[name] = await column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  }
  await ticket(page, 3).getByRole('link').first().click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('link', { name: '#map-hash' }).click()
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card).toContainText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveCount(0)
  await openBoard(page)
  for (const name of COLUMNS) {
    await expect(column(page, name)).toBeVisible()
    const now = await column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
    expect(now).toEqual(before[name])
  }
})
