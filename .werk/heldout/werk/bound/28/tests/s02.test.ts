import { afterAll, afterEach, expect, test } from 'bun:test'
import { closeBrowser, getBrowser, logEvents, logText, makeProject, ok, startServe, type RunningServer, type TempProject } from './lib.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})
afterAll(closeBrowser)

const show = (p: TempProject, id?: string) => {
  const r = p.run(id === undefined ? ['show'] : ['show', id])
  expect(r.code).toBe(0)
  return JSON.parse(r.stdout)
}

async function openPage(hash = '') {
  server = await startServe(project!.dir)
  const page = await (await getBrowser()).newPage()
  await page.goto(`http://localhost:${server.port}/${hash}`)
  await page.getByRole('main', { name: 'map' }).waitFor({ timeout: 15000 })
  await page.evaluate(() => Object.assign(window, { __noReload: true }))
  return page
}
const notReloaded = async (page: any) => expect(await page.evaluate(() => (window as any).__noReload)).toBe(true)

test('02.1 a retitle appends one event and the map shows only the new title', () => {
  project = makeProject()
  ok(project, 'add', 'a', '--title', 'Use a log')
  ok(project, 'add', 'b', '--title', 'Cards fold from it')
  ok(project, 'link', 'b', 'a', '--type', 'refines')
  const saved = logText(project.dir)
  ok(project, 'retitle', 'a', 'Use an append-only log')
  const now = logText(project.dir)
  expect(now.trim().split('\n').length).toBe(saved.trim().split('\n').length + 1)
  expect(now.startsWith(saved)).toBe(true)
  const root = show(project)
  const a = root.children.find((c: any) => c.id === 'a')
  expect(a.title).toBe('Use an append-only log')
  const page = show(project, 'a')
  expect(page.card.title).toBe('Use an append-only log')
  expect(project.run(['show', 'a']).stdout).toContain('Use an append-only log')
  // "Use a log" must not be the title of a in the printed map or the show output.
  expect(JSON.stringify(root)).not.toContain('"title": "Use a log"')
  expect(project.run(['show']).stdout).not.toContain('"title": "Use a log"')
  expect(project.run(['show', 'a']).stdout).not.toContain('"title": "Use a log"')
  expect(now).toContain('"title":"Use a log"')
})

test('02.2 a card added from the command line appears under its parent in the open page without a reload', async () => {
  project = makeProject()
  ok(project, 'add', 'a', '--title', 'Use an append-only log')
  const page = await openPage()
  const subcards = page.getByRole('region', { name: 'sub-cards' })
  await subcards.getByRole('link', { name: 'Use an append-only log' }).waitFor({ timeout: 5000 })
  ok(project, 'add', 'c', '--title', 'Fold is pure')
  ok(project, 'link', 'c', 'a', '--type', 'refines')
  // The map page shows the refines tree: "Fold is pure" sits inside the tree entry of "Use an append-only log".
  // Before the link lands, c is a top-level sibling, so only nesting counts.
  let nested = true
  try {
    await page.waitForFunction(() => {
      const items = [...document.querySelectorAll('main li, main [role=treeitem]')]
      return items.some((li) => li.textContent!.includes('Use an append-only log') && [...li.querySelectorAll('li, [role=treeitem], a')].some((x) => x.textContent!.includes('Fold is pure')))
    }, null, { timeout: 5000 })
  } catch {
    nested = false
  }
  const text = await page.locator('main').innerText()
  await notReloaded(page)
  expect({ nested, text }).toEqual({ nested: true, text: expect.stringMatching(/Use an append-only log[\s\S]*Fold is pure/) })
}, 60_000)

test('02.3 a status change from the command line shows in the browser and in show', async () => {
  project = makeProject()
  ok(project, 'add', 'a', '--title', 'Use an append-only log')
  const page = await openPage()
  const item = page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ hasText: 'Use an append-only log' })
  await item.waitFor({ timeout: 5000 })
  expect(await item.locator('.status').innerText()).toBe('open')
  const before = logEvents(project.dir)
  ok(project, 'status', 'a', 'decided')
  await item.locator('.status.decided').waitFor({ timeout: 5000 })
  expect(await item.locator('.status').innerText()).toBe('decided')
  await notReloaded(page)
  expect(show(project, 'a').card.status).toBe('decided')
  const after = logEvents(project.dir)
  expect(after.length).toBe(before.length + 1)
  const last = after.at(-1)
  expect(last.type).toBe('decided')
  expect(last.id).toBe('a')
  expect(last.seq).toBeGreaterThan(Math.max(...before.map((e) => e.seq)))
}, 60_000)

test('02.4 a card id in the location hash opens that card, and a reload keeps it', async () => {
  project = makeProject()
  ok(project, 'add', 'a', '--title', 'Use an append-only log')
  ok(project, 'add', 'b', '--title', 'Cards fold from it', '--parent', 'a')
  const page = await openPage('#b')
  const h1 = page.getByRole('heading', { level: 1 })
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Cards fold from it', null, { timeout: 5000 })
  expect(await h1.innerText()).toBe('Cards fold from it')
  expect(await page.getByRole('region', { name: 'card detail' }).innerText()).toContain('#b')
  await page.reload()
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Cards fold from it', null, { timeout: 5000 })
  expect(page.url()).toMatch(/#b$/)
  expect(await h1.innerText()).toBe('Cards fold from it')
}, 60_000)

test('02.5 a page control changes a card only by appending an event', async () => {
  project = makeProject()
  ok(project, 'add', 'a', '--title', 'Use an append-only log')
  ok(project, 'add', 'b', '--title', 'Cards fold from it', '--parent', 'a')
  const saved = logText(project.dir)
  const page = await openPage('#b')
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Cards fold from it', null, { timeout: 5000 })
  // A control that changes card b: any button, field, select, form or editable element on the card page.
  const controls = page.locator('button, input, textarea, select, form, [contenteditable], [role=button], [role=checkbox], [role=menuitem]')
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)
  await controls.first().click()
  await page.waitForTimeout(500)
  const now = logText(project.dir)
  expect(now.trim().split('\n').length).toBe(saved.trim().split('\n').length + 1)
  expect(now.startsWith(saved)).toBe(true)
}, 60_000)
