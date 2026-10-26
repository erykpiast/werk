/** Held-out steps 81.1–81.5: the ticket board in a browser, on the fixture project. */
import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket]').first()).toBeVisible()
}

test('81.1 every fixture ticket sits in the column its last event names', async ({ page }) => {
  await toBoard(page)
  const names = await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  const expected: [string, number[]][] = [['blocked', [4]], ['ready', [3]], ['building', [2]], ['merging', [5]], ['done', [1]]]
  for (const [name, numbers] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toBeVisible()
  }
  // Ticket 5 moved to building, then to merging.
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await toBoard(page)
  // Ticket 2 retried two times, ticket 3 one time.
  await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = (await ticket(page, n).innerText())
    expect(text).not.toContain('What to build')
    expect(text).not.toContain('make test')
    expect(text).not.toMatch(/#map|map-hash/)
  }
  await expect(ticket(page, 3)).not.toContainText('A reload opens the same card')
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // Setup: ticket 7 is blocked by ticket 1, in done, and ticket 3, in ready.
  const board = join(werk.dir, '.werk', 'board.jsonl')
  const seq = readFileSync(board, 'utf8').trim().split('\n').length
  const planned = { type: 'ticket.planned', payload: { number: 7, title: 'Wait for two tickets', cites: ['map'], blockedBy: [1, 3], stories: [3], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nWait.' } }
  appendFileSync(board, JSON.stringify({ seq: seq + 1, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...planned }) + '\n')
  await page.goto(werk.url)
  await toBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toHaveCount(1)
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 7).locator('[data-badge="blockers"]')).not.toContainText('2')
  // Ticket 4 has no blockers.
  await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  // Setup: a ticket with a long brief, two cited cards, one blocker and two retries.
  const board = join(werk.dir, '.werk', 'board.jsonl')
  const seq = readFileSync(board, 'utf8').trim().split('\n').length
  const brief = '## What to build\n\n' + 'The drawer shows the whole slice of the ticket, line after line. '.repeat(12) + 'THE END OF THE BRIEF.\n\n## Acceptance criteria\n\n- [ ] The whole brief shows.'
  const at = '2026-10-21T02:00:00.000Z'
  const lines = [
    { type: 'ticket.planned', payload: { number: 6, title: 'Show the long slice', cites: ['map-hash', 'fold'], blockedBy: [2], stories: [3], touches: ['map view'], checks: ['make test', 'make e2e'], brief } },
    { type: 'ticket.retried', payload: { number: 6 } },
    { type: 'ticket.retried', payload: { number: 6 } },
  ].map((e, i) => JSON.stringify({ seq: seq + i + 1, at, actor: 'agent', ...e }))
  appendFileSync(board, lines.join('\n') + '\n')
  await page.goto(werk.url)
  await toBoard(page)

  await ticket(page, 6).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('THE END OF THE BRIEF.')
  await expect(slice).toContainText('The whole brief shows.')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#fold')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText('retries2')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')

  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const boardBox = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height)
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await toBoard(page)
  const before = await page.locator('section.column').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('aria-label'), [...e.querySelectorAll('li[data-ticket]')].map((li) => li.getAttribute('data-ticket'))]),
  )
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveCount(0)
  const card = page.getByTestId('card')
  await expect(card).toHaveAttribute('data-card-id', 'map-hash')
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(card).toContainText('The address bar names the open card.')

  await toBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket]')).toHaveCount(1)
  const after = await page.locator('section.column').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('aria-label'), [...e.querySelectorAll('li[data-ticket]')].map((li) => li.getAttribute('data-ticket'))]),
  )
  expect(after).toEqual(before)
})
