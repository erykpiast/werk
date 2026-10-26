import { test, expect } from '@playwright/test'
import { cleanup, decidedCard, logEvents, logText, makeProject, must, realCard, serve, show, werk, type Server } from './helpers'

let dir: string | undefined
let server: Server | undefined
test.afterEach(async () => {
  await server?.stop()
  cleanup(dir)
  server = undefined
  dir = undefined
})

const sameDocument = async (page: import('@playwright/test').Page) => page.evaluate(() => Object.assign(window, { __heldout: true }))
const stillSameDocument = async (page: import('@playwright/test').Page) => expect(await page.evaluate(() => (window as any).__heldout)).toBe(true)

test('02.1 a retitle appends one event and the map shows only the new title', async () => {
  dir = makeProject()
  expect(werk(dir, 'add', 'a', '--title', 'Use a log').code).toBe(0)
  expect(werk(dir, 'add', 'b', '--title', 'Cards fold from it').code).toBe(0)
  expect(werk(dir, 'link', 'b', 'a', '--type', 'refines').code).toBe(0)
  const saved = logText(dir)
  const r = werk(dir, 'retitle', 'a', 'Use an append-only log')
  expect(r.code, `retitle output: ${r.out}`).toBe(0)
  const now = logText(dir)
  expect(now.split('\n').filter(Boolean).length).toBe(saved.split('\n').filter(Boolean).length + 1)
  expect(now.startsWith(saved)).toBe(true)
  const root = show(dir)
  expect(root.children.find((c: any) => c.id === 'a').title).toBe('Use an append-only log')
  expect(show(dir, 'a').card.title).toBe('Use an append-only log')
  expect(JSON.stringify(root)).not.toContain('"Use a log"')
  expect(JSON.stringify(show(dir, 'a'))).not.toContain('"Use a log"')
  expect(now).toContain('Use a log')
})

test('02.2 a card added from the command line appears in the open page without a reload', async ({ page }) => {
  dir = makeProject()
  realCard(dir, 'a', 'Use an append-only log')
  server = await serve(dir)
  await page.goto(`${server.url}/#a`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  await sameDocument(page)
  expect(werk(dir, 'add', 'c', '--title', 'Fold is pure').code).toBe(0)
  expect(werk(dir, 'link', 'c', 'a', '--type', 'refines').code).toBe(0)
  await expect(page.getByRole('region', { name: 'sub-cards' }).getByText('Fold is pure')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  await stillSameDocument(page)
})

test('02.3 a status change from the command line shows in the browser and in the command line', async ({ page }) => {
  dir = makeProject()
  // The Given card carries the decide facts, so it can be decided.
  realCard(dir, 'a', 'Use an append-only log', '--who', 'me')
  must(dir, 'edit', 'a', '--no-basis', 'the root decision')
  must(dir, 'kill', 'a', 'revisit if the log grows too big')
  server = await serve(dir)
  await page.goto(`${server.url}/#a`)
  const status = page.getByRole('region', { name: 'card detail' }).locator('.meta .status').first()
  await expect(status).toHaveText('open')
  await sameDocument(page)
  const before = logEvents(dir)
  const r = werk(dir, 'status', 'a', 'decided')
  expect(r.code, r.out).toBe(0)
  await expect(status).toHaveText('decided')
  await stillSameDocument(page)
  expect(show(dir, 'a').card.status).toBe('decided')
  const after = logEvents(dir)
  expect(after.length).toBe(before.length + 1)
  const last = after.at(-1)
  expect(last).toMatchObject({ type: 'decided', id: 'a' })
  expect(last.seq).toBeGreaterThan(Math.max(...before.map((e: any) => e.seq)))
})

test('02.4 a card id in the location hash opens that card, also after a reload', async ({ page }) => {
  dir = makeProject()
  realCard(dir, 'a', 'Use an append-only log')
  realCard(dir, 'b', 'Cards fold from it', '--parent', 'a')
  server = await serve(dir)
  await page.goto(`${server.url}/#b`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await expect(page).toHaveURL(/#b$/)
})

test('02.5 a page control changes a card only by appending an event', async ({ page }) => {
  dir = makeProject()
  realCard(dir, 'a', 'Use an append-only log')
  // b is a proposal under a: the ✓ is the page control that changes a card.
  must(dir, 'add', 'b', '--title', 'Cards fold from it', '--parent', 'a')
  const saved = logText(dir)
  server = await serve(dir)
  await page.goto(`${server.url}/#b`)
  const detail = page.getByRole('region', { name: 'card detail' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  const controls = page.locator('button, input, textarea, select, [contenteditable]')
  expect(await controls.count()).toBeGreaterThan(0)
  await sameDocument(page)
  await detail.getByRole('button', { name: 'accept #b' }).click()
  await expect(detail).toHaveClass('detail')
  await expect(detail.locator('.status.proposed')).toHaveCount(0)
  await stillSameDocument(page)
  const now = logText(dir)
  expect(now.split('\n').filter(Boolean).length).toBe(saved.split('\n').filter(Boolean).length + 1)
  expect(now.startsWith(saved)).toBe(true)
  const card = show(dir, 'b').card
  expect(card.proposed).toBeUndefined()
  expect(card.title).toBe(await page.getByRole('heading', { level: 1 }).textContent())
  expect(card.status).toBe(await detail.locator('.meta .status').first().textContent())
})
