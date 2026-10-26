import { expect, test } from '@playwright/test'
import { cleanup, logText, serve, tempProject, werk, type Served } from './helpers.ts'

let dir: string | undefined
let server: Served | undefined
test.afterEach(async () => {
  await server?.stop()
  if (dir) cleanup(dir)
  server = undefined
  dir = undefined
})

const markDocument = (page: import('@playwright/test').Page) => page.evaluate(() => Object.assign(window, { __heldoutSame: true }))
const sameDocument = (page: import('@playwright/test').Page) => page.evaluate(() => (window as { __heldoutSame?: boolean }).__heldoutSame === true)
const ok = (r: { code: number | null; err: string }) => expect(r.code, r.err).toBe(0)

test('01.1 werk serve in a project with no cards shows the empty map shell', async ({ page }) => {
  dir = tempProject()
  // When the user runs `werk serve` in that project directory
  server = await serve(dir, ['serve'])
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  // And opens the printed address
  await page.goto(server.url)
  // Then the browser shows a page that React renders
  await expect(page.getByRole('main', { name: 'map' })).toBeVisible()
  const reactRoot = await page.evaluate(() => Object.keys(document.getElementById('root') ?? {}).some((k) => k.startsWith('__reactContainer')))
  expect(reactRoot).toBe(true)
  // And an empty map shell with no cards
  await expect(page.getByText('The map has no cards yet.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'sub-cards' })).toHaveCount(0)
  await expect(page.locator('main a')).toHaveCount(0)
  // And no error on the page or in the server output
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
  expect(server.output()).not.toMatch(/error|warn|exception/i)
})

test('02.2 a card added from the command line appears in an open page without a reload', async ({ page }) => {
  dir = tempProject()
  ok(werk(dir, 'add', 'a', '--title', 'Use an append-only log'))
  server = await serve(dir)
  // The user opens the map in the browser
  await page.goto(server.url)
  const subcards = page.getByRole('region', { name: 'sub-cards' })
  await expect(subcards.getByRole('link', { name: 'Use an append-only log', exact: true })).toBeVisible()
  await markDocument(page)
  ok(werk(dir, 'add', 'c', '--title', 'Fold is pure'))
  ok(werk(dir, 'link', 'c', 'a', '--type', 'refines'))
  // Then the page shows "Fold is pure" under "Use an append-only log" in the refines tree
  const itemA = subcards.locator('li', { has: page.getByRole('link', { name: 'Use an append-only log', exact: true }) })
  await expect(itemA.getByText('Fold is pure')).toBeVisible({ timeout: 5_000 })
  expect(await sameDocument(page)).toBe(true)
})

test('02.2 supplementary: with card a open, its sub-cards gain "Fold is pure" without a reload', async ({ page }) => {
  dir = tempProject()
  ok(werk(dir, 'add', 'a', '--title', 'Use an append-only log'))
  server = await serve(dir)
  await page.goto(server.url + '/#a')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  await markDocument(page)
  ok(werk(dir, 'add', 'c', '--title', 'Fold is pure'))
  ok(werk(dir, 'link', 'c', 'a', '--type', 'refines'))
  await expect(page.getByRole('region', { name: 'sub-cards' }).getByRole('link', { name: 'Fold is pure' })).toBeVisible({ timeout: 5_000 })
  expect(await sameDocument(page)).toBe(true)
})

test('02.3 a status change from the command line shows in the browser and in the command line', async ({ page }) => {
  dir = tempProject()
  ok(werk(dir, 'add', 'a', '--title', 'Use an append-only log'))
  server = await serve(dir)
  await page.goto(server.url)
  const itemA = page.getByRole('region', { name: 'sub-cards' }).locator('li', { has: page.getByRole('link', { name: 'Use an append-only log', exact: true }) })
  await expect(itemA).toBeVisible()
  await expect(itemA.locator('.status')).not.toHaveText('decided')
  await markDocument(page)
  const before = logText(dir).split('\n').filter(Boolean)
  // When the agent sets the status of card a to decided from the command line
  ok(werk(dir, 'status', 'a', 'decided'))
  // Then the page shows card a as decided without a reload
  await expect(itemA.locator('.status')).toHaveText('decided', { timeout: 5_000 })
  expect(await sameDocument(page)).toBe(true)
  // And show for card a prints the status decided
  const show = werk(dir, 'show', 'a')
  ok(show)
  expect(JSON.parse(show.out).card.status).toBe('decided')
  // And the log has one event for the status change after all earlier events
  const after = logText(dir).split('\n').filter(Boolean)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  const last = JSON.parse(after.at(-1)!)
  expect(last.id).toBe('a')
  expect(last.type).toBe('decided')
  expect(last.seq).toBeGreaterThan(Math.max(...before.map((l) => JSON.parse(l).seq)))
})

test('02.4 a card id in the location hash opens that card', async ({ page }) => {
  dir = tempProject()
  ok(werk(dir, 'add', 'a', '--title', 'Use an append-only log'))
  ok(werk(dir, 'add', 'b', '--title', 'Cards fold from it', '--parent', 'a'))
  server = await serve(dir)
  await page.goto(server.url + '/#b')
  const detail = page.getByRole('region', { name: 'card detail' })
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await expect(detail).toContainText('#b')
  await page.reload()
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await expect(detail).toContainText('#b')
  await expect(page).toHaveURL(/#b$/)
})

test('02.5 a page control changes a card only by appending an event', async ({ page }) => {
  dir = tempProject()
  ok(werk(dir, 'add', 'a', '--title', 'Use an append-only log'))
  ok(werk(dir, 'add', 'b', '--title', 'Cards fold from it', '--parent', 'a'))
  const saved = logText(dir)
  server = await serve(dir)
  await page.goto(server.url + '/#b')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  // When the user uses a control on the page that changes card b
  const controls = page.locator('input, textarea, select, button, form, [contenteditable], [role="button"], [role="checkbox"], [role="menuitem"]')
  const count = await controls.count()
  expect(count, 'a control on the page of card b that changes the card').toBeGreaterThan(0)
  await controls.first().click()
  // Then the log has exactly one more event, and the start is byte-for-byte the same
  await expect.poll(() => logText(dir!).split('\n').filter(Boolean).length).toBe(saved.split('\n').filter(Boolean).length + 1)
  expect(logText(dir).startsWith(saved)).toBe(true)
  const shown = JSON.parse(werk(dir, 'show', 'b').out)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shown.card.title)
  await expect(page.getByRole('region', { name: 'card detail' }).locator('.status').first()).toHaveText(shown.card.status)
})
