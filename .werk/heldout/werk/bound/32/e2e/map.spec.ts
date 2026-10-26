/** 02.2–02.5 and 07.1–07.5: the map in the browser. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/fixtures.ts'

const REPO = join(import.meta.dirname, '..', '..')
const FAKE_BIN = join(REPO, 'src', 'test', 'fake-claude', 'bin')

let seq = 0
function append(project: string, ...events: [string, object][]) {
  const lines = events.map(([type, payload]) =>
    JSON.stringify({ seq: ++seq, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type, payload }),
  )
  appendFileSync(join(project, '.werk', 'log.jsonl'), `${lines.join('\n')}\n`)
}
const card = (id: string, title: string, extra: object = {}): [string, object] => ['node.added', { id, kind: 'card', title, ...extra }]
const link = (from: string, type: string, to: string): [string, object] => ['edge.added', { from, to, type }]

/** The agent runs a werk verb from the command line in the served project. */
function werkCli(project: string, ...args: string[]) {
  const r = spawnSync('bun', [join(REPO, 'src', 'cli.ts'), ...args], {
    cwd: project,
    env: { ...process.env, PATH: `${FAKE_BIN}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
function werkOk(project: string, ...args: string[]) {
  const r = werkCli(project, ...args)
  expect({ cmd: `werk ${args.join(' ')}`, ...r }).toMatchObject({ code: 0 })
  return r
}

const map = (page: Page) => page.getByRole('region', { name: 'Map' })
const title = (page: Page) => map(page).getByRole('heading', { level: 2 })
const markReload = (page: Page) => page.evaluate(() => Object.assign(window, { heldoutMark: true }))
const notReloaded = async (page: Page) => expect(await page.evaluate(() => 'heldoutMark' in window)).toBe(true)

test('02.2 a card added from the command line appears in an open page without a reload', async ({ page, werk }) => {
  append(werk.project, card('a', 'Use an append-only log'))
  await page.goto(werk.url)
  await expect(map(page).getByRole('link', { name: 'Use an append-only log' })).toBeVisible()
  await markReload(page)
  werkOk(werk.project, 'add', 'c', '--title', 'Fold is pure')
  werkOk(werk.project, 'link', 'c', 'refines', 'a')
  await page.goto(`${werk.url}/#a`)
  await expect(map(page).getByRole('navigation', { name: 'Sub-cards' })).toContainText('Fold is pure')
  await notReloaded(page)
})

test('02.3 a status change from the command line shows in the browser and in the command line', async ({ page, werk }) => {
  append(werk.project, card('a', 'Use an append-only log'))
  await page.goto(`${werk.url}/#a`)
  await expect(title(page)).toHaveText('Use an append-only log')
  await markReload(page)
  const before = readFileSync(join(werk.project, '.werk', 'log.jsonl'), 'utf8')
  werkOk(werk.project, 'status', 'a', 'decided')
  await expect(map(page).locator('[data-status="decided"]')).toBeVisible()
  await notReloaded(page)
  expect(werkOk(werk.project, 'show', 'a').out).toContain('decided')
  const after = readFileSync(join(werk.project, '.werk', 'log.jsonl'), 'utf8')
  expect(after.startsWith(before)).toBe(true)
  expect(after.slice(before.length).trim().split('\n')).toHaveLength(1)
})

test('02.4 a card id in the location hash opens that card', async ({ page, werk }) => {
  append(werk.project, card('a', 'Use an append-only log'), card('b', 'Cards fold from it'), link('b', 'refines', 'a'))
  await page.goto(`${werk.url}/#b`)
  await expect(title(page)).toHaveText('Cards fold from it')
  await expect(map(page).locator('article')).toHaveAttribute('data-card', 'b')
  await page.reload()
  await expect(title(page)).toHaveText('Cards fold from it')
  await expect(map(page).locator('article')).toHaveAttribute('data-card', 'b')
})

test('02.5 a page control changes a card only by appending an event', async ({ page, werk }) => {
  append(werk.project, card('a', 'Use an append-only log'), card('b', 'Cards fold from it'), link('b', 'refines', 'a'))
  const saved = readFileSync(join(werk.project, '.werk', 'log.jsonl'), 'utf8')
  await page.goto(`${werk.url}/#b`)
  await expect(title(page)).toHaveText('Cards fold from it')
  // Any control on the card that changes it: a button, a text box, a select, or a checkbox.
  const controls = map(page).locator('button, input, select, textarea, [contenteditable="true"], [role="button"]')
  await expect(controls.first()).toBeVisible({ timeout: 5000 })
})

test('07.1 a known card reference in a card body opens that card', async ({ page, werk }) => {
  append(werk.project, card('al-diff', 'The diff card'), card('notes-card', 'Notes', { body: 'see #al-diff and #ghost-card for details' }))
  await page.goto(`${werk.url}/#notes-card`)
  const detail = map(page).getByRole('region', { name: 'Detail' })
  await expect(detail).toContainText('#ghost-card')
  await expect(detail.getByRole('link', { name: '#ghost-card' })).toHaveCount(0)
  const ref = detail.getByRole('link', { name: '#al-diff' })
  await expect(ref).toBeVisible()
  await ref.click()
  await expect(map(page).locator('article')).toHaveAttribute('data-card', 'al-diff')
})

test('07.2 bare ids and code spans link only when they have the shape of an id', async ({ page, werk }) => {
  append(
    werk.project,
    card('align', 'Align'),
    card('al-diff', 'The diff card'),
    ['node.added', { id: 'pr-iface:opt0', kind: 'option', title: 'An option' }],
    card('host', 'Host', { why: 'compare al-diff with pr-iface:opt0, then align the rest' }),
    ['node.added', { id: 'host:note0', kind: 'card', title: 'A note', body: '`al-diff` and `node src/cli.ts show #al-diff` and `**bold** and _italic_`' }],
  )
  await page.goto(`${werk.url}/#host`)
  const why = map(page).getByLabel('Why')
  await expect(why).toHaveText('compare al-diff with pr-iface:opt0, then align the rest')
  await expect(why.getByRole('link', { name: 'al-diff' })).toBeVisible()
  await expect(why.getByRole('link', { name: 'pr-iface:opt0' })).toBeVisible()
  await expect(why.getByRole('link', { name: 'align' })).toHaveCount(0)
  // The notes thread of the card.
  const notes = map(page).getByRole('region', { name: /notes/i })
  await expect(notes.locator('code', { hasText: /^al-diff$/ }).locator('xpath=ancestor-or-self::a')).toHaveCount(1)
  await expect(notes.locator('code', { hasText: 'node src/cli.ts show #al-diff' }).locator('a')).toHaveCount(0)
  await expect(notes.locator('code', { hasText: '**bold** and _italic_' })).toBeVisible()
})

test('07.3 the link rule leaves fenced blocks, headings and URL fragments alone', async ({ page, werk }) => {
  append(
    werk.project,
    card('al-diff', 'The diff card'),
    card('doc', 'Doc', { body: '# al-diff\n\n```\n#al-diff\n```\n\n[page](https://example.com/page#al-diff)\n' }),
  )
  await page.goto(`${werk.url}/#doc`)
  const detail = map(page).getByRole('region', { name: 'Detail' })
  await expect(detail.getByRole('heading', { name: 'al-diff' })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'al-diff' }).getByRole('link')).toHaveCount(0)
  await expect(detail.locator('pre code', { hasText: '#al-diff' })).toBeVisible()
  await expect(detail.locator('pre a')).toHaveCount(0)
  await expect(detail.locator('a[href="https://example.com/page#al-diff"]')).toHaveCount(1)
})

test('07.4 a grid tile summary shows a reference without a link', async ({ page, werk }) => {
  append(werk.project, card('al-diff', 'The diff card'), card('second', 'Second', { summary: 'depends on #al-diff', body: 'depends on #al-diff' }))
  await page.goto(werk.url)
  const tile = map(page).locator('[role="gridcell"], [data-tile], .tile').filter({ hasText: 'depends on #al-diff' })
  await expect(tile).toHaveCount(1, { timeout: 5000 })
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(map(page).locator('article')).toHaveAttribute('data-card', 'second')
})

test('07.5 fenced code is boxed, highlighted and scrolls sideways without reformatting', async ({ page, werk }) => {
  const long = `"${'x'.repeat(400)}"`
  const body = [
    '```json',
    '{',
    '      "a": 1,',
    '  "b":   [1,2],',
    `   "long": ${long}`,
    '}',
    '```',
    '```js',
    'const a = 1',
    '```',
    '```ts',
    'let b: number = 2',
    '```',
    '```bash',
    'echo "hi"',
    '```',
  ].join('\n')
  append(werk.project, card('code', 'Code', { body }))
  await page.goto(`${werk.url}/#code`)
  const detail = map(page).getByRole('region', { name: 'Detail' })
  const blocks = detail.locator('pre')
  await expect(blocks).toHaveCount(4, { timeout: 5000 })
  for (let i = 0; i < 4; i++) {
    // Syntax colors: more than one colored token in the block.
    const colors = await blocks.nth(i).evaluate((el) => new Set([...el.querySelectorAll('span')].map((s) => getComputedStyle(s).color)).size)
    expect(colors).toBeGreaterThan(1)
  }
  await expect(blocks.nth(0)).toContainText('      "a": 1,')
  const scroll = await blocks.nth(0).evaluate((el) => {
    const s = getComputedStyle(el)
    return { overflowX: s.overflowX, wider: el.scrollWidth > el.clientWidth }
  })
  expect(scroll.wider).toBe(true)
  expect(['auto', 'scroll']).toContain(scroll.overflowX)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
