import { expect, test, type Werk } from '../../e2e/harness.ts'
import type { Page } from '@playwright/test'

/** A real card under #map (a card in the fixture). */
function card(werk: Werk, id: string, title: string, extra: string[] = []) {
  werk.cli(['add', id, '--title', title, '--parent', 'map', ...extra])
  werk.cli(['accept', id, '--actor', 'you'])
}

/** A real decided card under the decided root #werk, with a decider and a kill criterion, depending on deps. */
function decided(werk: Werk, id: string, title: string, deps: string[] = []) {
  werk.cli(['add', id, '--title', title, '--parent', 'werk', '--who', 'me'])
  werk.cli(['accept', id, '--actor', 'you'])
  for (const d of deps) werk.cli(['link', id, d, '--type', 'depends_on', '--why', `${id} takes from ${d}`])
  werk.cli(['kill', id, '--form', 'revisit'])
  werk.cli(['status', id, 'decided'])
}

const tile = (page: Page, id: string) => page.locator(`li[data-card-id="${id}"] > a`)
const markOf = (page: Page, id: string, kind: string) => tile(page, id).locator(`.mark[data-mark="${kind}"]`)

// ---------- 71 ----------

test('71.1 known card ids in a body become links, other text stays plain', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Diff the alignment')
  card(werk, 'align', 'Align things')
  const body = 'See #al-diff and #ghost-card, then al-diff and align. Run `node src/cli.ts show #al-diff` now.'
  card(werk, 'notes-card', 'Notes', ['--body', body])
  await page.goto(`${werk.url}#notes-card`)
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a')).toHaveCount(2)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Diff the alignment')
  card(werk, 'pr-iface', 'The PR interface', ['--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their form; a code span id links', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Diff the alignment')
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` here.', '', '```', '#al-diff', '```'].join('\n')
  card(werk, 'doc-card', 'Doc', ['--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const h = b.locator('h1')
  await expect(h).toHaveText('al-diff')
  await expect(h.locator('a')).toHaveCount(0)
  const urlPara = b.locator('p', { hasText: 'https://example.com/page' })
  await expect(urlPara.locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const spanPara = b.locator('p', { hasText: 'The span' })
  await expect(spanPara.locator('a[href="#al-diff"]')).toHaveCount(1)
})

test('71.4 a tile summary holds no link, a note on the open card does', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Diff the alignment')
  card(werk, 'ref-card', 'Follows up on #al-diff')
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  // The fixture's #map is a child of #werk in the tree.
  const t = tile(page, 'ref-card')
  await expect(t).toContainText('Follows up on #al-diff')
  await expect(t.locator('a')).toHaveCount(0)
  await t.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

test('71.5 fenced code is boxed, highlighted, keeps indentation, and scrolls sideways', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": {', long, '        }', '    }', '}']
  card(werk, 'code-card', 'Code', ['--body', ['Intro text.', '', '```json', ...lines, '```', '', 'After text.'].join('\n')])
  await page.goto(`${werk.url}#code-card`)
  const article = page.getByTestId('card')
  const pre = article.locator('.body pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  const body = article.locator('.body')
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await article.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

// ---------- 72 ----------

const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const GREEN = 'rgb(46, 125, 50)'

test('72.1 a rejected reopen marks only the direct dependent stale, in red', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cb', 'Card B', ['ca'])
  decided(werk, 'cc', 'Card C', ['cb'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  await expect(markOf(page, 'cb', 'stale')).toHaveCount(1)
  await expect(markOf(page, 'cb', 'stale')).toHaveCSS('background-color', RED)
  await expect(tile(page, 'cb')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cb')).toHaveCSS('border-left-color', GREEN)
  await expect(markOf(page, 'cc', 'stale')).toHaveCount(0)
  await expect(markOf(page, 'cc', 'paused')).toHaveCount(0)
})

test('72.2 a postponed reopen pauses every downstream card in grey and keeps the status colour', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cb', 'Card B', ['ca'])
  decided(werk, 'cc', 'Card C', ['cb'])
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'It waits'])
  await page.goto(werk.url)
  for (const id of ['cb', 'cc']) {
    await expect(markOf(page, id, 'paused')).toHaveCount(1)
    await expect(markOf(page, id, 'paused')).toHaveCSS('background-color', GREY)
    await expect(markOf(page, id, 'stale')).toHaveCount(0)
  }
  await expect(tile(page, 'cc')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cc')).toHaveCSS('border-left-color', GREEN)
})

test('72.3 the card view of a stale card explains the change, the link and the reason', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cb', 'Card B', ['ca'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible()
  await expect(marks).toContainText('#ca')
  await expect(marks).toContainText('reopened')
  await expect(marks).toContainText('depends_on')
  await expect(marks).toContainText('rejected')
  await expect(marks).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and reason', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cb', 'Card B', ['ca'])
  decided(werk, 'cc', 'Card C', ['cb'])
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'cc').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks).toContainText('#ca')
  await expect(marks).toContainText('reopened')
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
  // Checked last: the step names the heading text exactly.
  await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible({ timeout: 3000 })
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cx', 'Card X')
  decided(werk, 'cb', 'Card B', ['ca', 'cx'])
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'X waits'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'A is wrong'])
  await page.goto(werk.url)
  await expect(markOf(page, 'cb', 'stale')).toHaveCount(1)
  await expect(markOf(page, 'cb', 'stale')).toHaveCSS('background-color', RED)
  await expect(markOf(page, 'cb', 'paused')).toHaveCount(0)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.locator('li[data-cause="ca"][data-reason="rejected"]')).toHaveCount(1)
  await expect(marks).toContainText('rejected')
})
