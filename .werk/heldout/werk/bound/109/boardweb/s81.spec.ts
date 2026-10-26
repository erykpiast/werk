import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { card, column, moved, numbersIn, openBoard, planned, writeBoard } from './helpers.ts'

const COLS = ['blocked', 'ready', 'building', 'merging', 'done']

test('81.1 every fixture ticket shows in the column its last event names', async ({ page, werk }) => {
  const events = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const where = new Map<number, string>()
  const seen = new Map<number, string[]>()
  for (const e of events) {
    if (e.type === 'ticket.planned' && !where.has(e.payload.number)) where.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') {
      where.set(e.payload.number, e.payload.to)
      seen.set(e.payload.number, [...(seen.get(e.payload.number) ?? []), e.payload.to])
    }
  }
  // Given: every state has a ticket, and one ticket went building then merging.
  expect(new Set(where.values())).toEqual(new Set(COLS))
  const movedTwice = [...seen].find(([, tos]) => tos.at(-2) === 'building' && tos.at(-1) === 'merging')![0]

  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  await openBoard(page)
  await expect(page.locator('section.column')).not.toHaveCount(0)
  const names = await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLS)
  for (const [n, col] of where) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  for (const col of COLS) await expect(column(page, col).locator('li[data-ticket]')).toHaveCount([...where.values()].filter((c) => c === col).length)
  for (const col of COLS.filter((c) => c !== 'merging')) await expect(column(page, col).locator(`li[data-ticket="${movedTwice}"]`)).toHaveCount(0)
  await expect(column(page, 'merging').locator(`li[data-ticket="${movedTwice}"]`)).toHaveCount(1)
})

test('81.2 a card shows a retry count only after more than one retry', async ({ page }) => {
  // The fixture: ticket 2 retried two times, ticket 3 one time.
  await openBoard(page)
  await expect(card(page, 2).getByRole('link').first()).toHaveText('Draw the map in a browser')
  await expect(card(page, 2).locator('[data-badge="retries"]')).toHaveText(/2/)
  await expect(card(page, 3).getByRole('link').first()).toHaveText('Open a card from the address bar')
  await expect(card(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  await expect(card(page, 3)).not.toContainText('↻')
  for (const [n, brief, cites] of [
    [2, 'The server sends the fold', ['#map']],
    [3, 'A person opens a card', ['#map-hash', '#map']],
  ] as const) {
    const text = (await card(page, n).innerText()) ?? ''
    expect(text).not.toContain(brief)
    expect(text).not.toContain('What to build')
    for (const c of cites) expect(text).not.toContain(c)
    expect(text).not.toContain('make test')
    expect(text).not.toContain('make e2e')
  }
})

test('81.3 a card counts only the blockers that are not done', async ({ page, werk }) => {
  writeBoard(werk, [
    planned({ number: 1, title: 'Done blocker' }),
    planned({ number: 2, title: 'Ready blocker' }),
    planned({ number: 3, title: 'Blocked by two', blockedBy: [1, 2] }),
    planned({ number: 4, title: 'No blockers' }),
    moved(1, 'building'),
    moved(1, 'merging'),
    moved(1, 'done'),
  ])
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="2"]')).toBeVisible()
  await expect(card(page, 3).locator('[data-badge="blockers"]')).toHaveText(/(^|\D)1$/)
  await expect(card(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
  await expect(card(page, 4)).not.toContainText('⛔')
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const long =
    '## What to build\n\n' +
    Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the long brief explains one more part of the work in plain words.`).join('\n\n') +
    '\n\n## Acceptance criteria\n\n- The LAST-LINE-MARK criterion holds.'
  writeBoard(werk, [
    planned({ number: 11, title: 'The blocker ticket' }),
    planned({ number: 10, title: 'The rich ticket', brief: long, cites: ['map-hash', 'fold'], blockedBy: [11], checks: ['make test', 'make e2e'] }),
    { type: 'ticket.retried', payload: { number: 10 } },
    { type: 'ticket.retried', payload: { number: 10 } },
  ])
  await openBoard(page)
  await card(page, 10).getByRole('link', { name: 'The rich ticket' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)

  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  for (let i = 1; i <= 12; i++) await expect(slice).toContainText(`Paragraph ${i} of the long brief`)
  await expect(slice).toContainText('The LAST-LINE-MARK criterion holds.')
  const l = (await slice.boundingBox())!
  const r = (await meta.boundingBox())!
  expect(l.x + l.width).toBeLessThanOrEqual(r.x)
  await expect(meta).toContainText('#map-hash')
  await expect(meta).toContainText('#fold')
  await expect(meta).toContainText('The blocker ticket')
  await expect(meta).toContainText(/retries\s*2/)
  await expect(meta).toContainText('make test')
  await expect(meta).toContainText('make e2e')

  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeInViewport()
  const colBox = (await column(page, 'ready').boundingBox())!
  expect(colBox.y).toBeLessThan((await drawer.boundingBox())!.y)
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  const snapshot = async () => {
    const out: Record<string, number[]> = {}
    for (const name of COLS) out[name] = await numbersIn(page, name)
    return out
  }
  await expect(page.locator('li[data-ticket]').first()).toBeVisible()
  const before = await snapshot()
  // Ticket 3 cites the card map-hash.
  await card(page, 3).getByRole('link').first().click()
  await page.getByRole('region', { name: 'drawer' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('section.column')).toHaveCount(0)
  const open = page.getByTestId('card')
  await expect(open).toHaveAttribute('data-card-id', 'map-hash')
  await expect(open.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(open).toContainText('The address bar names the open card.')

  await openBoard(page)
  await expect(page.locator('section.column')).not.toHaveCount(0)
  const names = await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(COLS)
  await expect.poll(snapshot).toEqual(before)
})
