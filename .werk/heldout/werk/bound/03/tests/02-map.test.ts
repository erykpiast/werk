import { afterAll, afterEach, expect, test } from 'bun:test'
import { closeBrowser, decidable, events, logOf, makeProject, must, openPage, show, startServe, type RunningServer, type TempProject } from './lib.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})
afterAll(closeBrowser)

const T = 60_000

test('02.1 a retitle appends one event and the map shows only the new title', () => {
  project = makeProject()
  must(project, ['add', 'a', '--title', 'Use a log'])
  must(project, ['add', 'b', '--title', 'Cards fold from it'])
  must(project, ['link', 'b', 'a', '--type', 'refines'])
  const saved = logOf(project)
  const savedCount = saved.split('\n').filter(Boolean).length

  const r = project.run(['retitle', 'a', 'Use an append-only log'])
  expect(r.code).toBe(0)
  const now = logOf(project)
  expect(now.split('\n').filter(Boolean).length).toBe(savedCount + 1)
  expect(now.startsWith(saved)).toBe(true)

  const root = show(project)
  expect(root.code).toBe(0)
  const rootA = root.json.children.find((c: { id: string }) => c.id === 'a')
  expect(rootA.title).toBe('Use an append-only log')
  const a = show(project, 'a')
  expect(a.stdout).toContain('Use an append-only log')
  expect(a.json.card.title).toBe('Use an append-only log')
  expect(rootA.title).not.toBe('Use a log')
  expect(a.stdout).not.toContain('"Use a log"')
  expect(root.stdout).not.toContain('"Use a log"')
  expect(now).toContain('"Use a log"')
})

test('02.2 a card added from the command line appears in an open page without a reload', async () => {
  project = makeProject()
  must(project, ['add', 'a', '--title', 'Use an append-only log'])
  server = await startServe(project.dir)
  // Reading: the product draws the refines tree one page per card; the page of "a" lists its sub-cards.
  const { page } = await openPage(`http://localhost:${server.port}/#a`)
  await page.getByRole('heading', { level: 1, name: 'Use an append-only log' }).waitFor({ timeout: 10_000 })
  await page.evaluate(() => Object.assign(window, { __noReload: true }))

  must(project, ['add', 'c', '--title', 'Fold is pure'])
  must(project, ['link', 'c', 'a', '--type', 'refines'])

  const sub = page.getByRole('region', { name: 'sub-cards' })
  await sub.getByRole('link', { name: 'Fold is pure' }).waitFor({ timeout: 10_000 })
  expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Use an append-only log')
  expect(await page.evaluate(() => (window as { __noReload?: boolean }).__noReload)).toBe(true)
  await page.close()
}, T)

test('02.3 a status change from the command line shows in the browser and in the command line', async () => {
  project = makeProject()
  // Given: the card carries the decide facts, so that the move to decided is allowed.
  decidable(project, 'a', 'Use an append-only log')
  server = await startServe(project.dir)
  const { page } = await openPage(`http://localhost:${server.port}/#a`)
  const status = page.getByRole('region', { name: 'card detail' }).locator('.status')
  await expect(status).toBeDefined()
  await page.waitForFunction(() => document.querySelector('.status')?.textContent === 'open', undefined, { timeout: 10_000 })
  await page.evaluate(() => Object.assign(window, { __noReload: true }))
  const before = events(project).length

  const r = project.run(['status', 'a', 'decided'])
  expect(r.code).toBe(0)
  await page.waitForFunction(() => document.querySelector('.status')?.textContent === 'decided', undefined, { timeout: 10_000 })
  expect(await page.evaluate(() => (window as { __noReload?: boolean }).__noReload)).toBe(true)
  expect(show(project, 'a').json.card.status).toBe('decided')
  const all = events(project)
  expect(all.length).toBe(before + 1)
  const last = all.at(-1)
  expect(last.type).toBe('decided')
  expect(last.id).toBe('a')
  expect(all.slice(0, -1).every((e: { seq: number }) => e.seq < last.seq)).toBe(true)
  await page.close()
}, T)

test('02.4 a card id in the location hash opens that card', async () => {
  project = makeProject()
  must(project, ['add', 'a', '--title', 'Use an append-only log'])
  must(project, ['add', 'b', '--title', 'Cards fold from it', '--parent', 'a'])
  server = await startServe(project.dir)
  const { page } = await openPage(`http://localhost:${server.port}/#b`)
  await page.getByRole('heading', { level: 1, name: 'Cards fold from it' }).waitFor({ timeout: 10_000 })
  await page.reload()
  await page.getByRole('heading', { level: 1, name: 'Cards fold from it' }).waitFor({ timeout: 10_000 })
  expect(page.url()).toMatch(/#b$/)
  await page.close()
}, T)

test('02.5 a page control changes a card only by appending an event', async () => {
  project = makeProject()
  must(project, ['add', 'a', '--title', 'Use an append-only log'])
  must(project, ['add', 'b', '--title', 'Cards fold from it', '--parent', 'a'])
  const saved = logOf(project)
  server = await startServe(project.dir)
  const { page } = await openPage(`http://localhost:${server.port}/#b`)
  await page.getByRole('heading', { level: 1, name: 'Cards fold from it' }).waitFor({ timeout: 10_000 })
  // When: the user uses a control on the page that changes card "b".
  const controls = await page.locator('input, textarea, select, button, form, [contenteditable], [role=button]').count()
  console.log(`02.5: controls on the page of #b: ${controls}`)
  expect(controls).toBeGreaterThan(0)
  await page.locator('input, textarea, select, button, [contenteditable], [role=button]').first().click()
  expect(logOf(project).startsWith(saved)).toBe(true)
  expect(logOf(project).split('\n').filter(Boolean).length).toBe(saved.split('\n').filter(Boolean).length + 1)
  await page.close()
}, T)
