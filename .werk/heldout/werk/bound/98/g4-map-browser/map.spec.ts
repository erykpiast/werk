/** Held-out steps 69–72: the map in a browser. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const tile = (page: Page, id: string) => page.locator(`${card(id)} > a`)
const DECIDED = 'rgb(46, 125, 50)'
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'

const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real card, proposed and accepted on the command line. */
function real(werk: Werk, id: string, title: string, parent?: string) {
  werk.cli(['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
  werk.cli(['accept', id, '--actor', 'you'])
}

/** Makes a real card decided: a decider, a kill criterion, and no option weighed. */
function decide(werk: Werk, id: string, opts: { noBasis?: boolean } = {}) {
  werk.cli(['edit', id, '--who', 'me', ...(opts.noBasis ? ['--no-basis', 'a root decision'] : [])])
  werk.cli(['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  werk.cli(['status', id, 'decided', '--unchallenged'])
}

// ---------- 69 ----------

test('69.1 the map shows the fixture project as a refines tree', async ({ page, werk }) => {
  real(werk, 'hroot', 'Held-out root')
  real(werk, 'hchild1', 'Held-out child one', 'hroot')
  real(werk, 'hchild2', 'Held-out child two', 'hroot')
  real(werk, 'hgrand', 'Held-out grandchild', 'hchild1')
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('hroot')} > a`)).toContainText('Held-out root')
  await expect(map.locator(`> ${card('hroot')} > ul > ${card('hchild1')} > a`)).toContainText('Held-out child one')
  await expect(map.locator(`> ${card('hroot')} > ul > ${card('hchild2')} > a`)).toContainText('Held-out child two')
  await expect(map.locator(`> ${card('hroot')} > ul > ${card('hchild1')} > ul > ${card('hgrand')}`)).toBeVisible()
  await expect(map.locator(`> ${card('hroot')} > ul > ${card('hgrand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted on the command line appears with no reload', async ({ page, werk }) => {
  await expect(tile(page, 'werk')).toBeVisible()
  await expect(page.getByText('Use an append-only log', { exact: false })).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'aolog', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aolog', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aolog')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5_000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await tile(page, 'map').click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

// ---------- 70 ----------

function payments(werk: Werk) {
  real(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expect(refunds).toHaveCSS('border-top-style', 'dashed')
  await expect(refunds).toHaveCSS('color', 'rgb(138, 138, 138)')
  const pay = tile(page, 'payments')
  await expect(pay).not.toHaveCSS('border-top-style', 'dashed')
  await expect(pay).not.toHaveCSS('color', 'rgb(138, 138, 138)')
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  payments(werk)
  await tile(page, 'refunds').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  const before = logLines(werk).length
  await page.locator('button', { hasText: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.locator('button', { hasText: '✓' })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await tile(page, 'partial').click()
  await page.locator('button', { hasText: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds:opt0', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'customers want money'])
  werk.cli(['link', 'refunds:opt0', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refsrc', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refsrc', '--type', 'supported_by'])
  await expect(tile(page, 'chargebacks')).toBeVisible()
  // The map itself has no accept control, so nothing accepts both ghosts together.
  await expect(page.getByRole('button')).toHaveCount(0)
  await tile(page, 'refunds').click()
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.locator('button', { hasText: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  expect(werk.cli(['show', 'refunds:opt0'])).toContain('state: real')
  expect(werk.cli(['show', 'refsrc'])).toContain('state: real')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(tile(page, 'chargebacks')).toHaveCSS('border-top-style', 'dashed')
  await expect(tile(page, 'chargebacks')).toHaveCSS('color', 'rgb(138, 138, 138)')
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  payments(werk)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await tile(page, 'refunds').click()
  await page.locator('button', { hasText: '✓' }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})

// ---------- 71 ----------

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  werk.cli(['add', 'align', '--title', 'Align'])
  const body = 'See #al-diff and #ghost-card, then al-diff and align.\n\nRun `node src/cli.ts show #al-diff` now.'
  werk.cli(['add', 'notes-card', '--title', 'Notes', '--body', body])
  await tile(page, 'notes-card').click()
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
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  werk.cli(['add', 'pr-iface', '--title', 'The PR interface', '--why', 'It builds on #al-diff.'])
  await tile(page, 'pr-iface').click()
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` is a reference.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc card', '--body', body])
  await tile(page, 'doc-card').click()
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveCount(1)
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b.locator('a[href="#al-diff"]', { hasText: 'example.com' })).toHaveCount(0)
  await expect(b.locator('p', { hasText: 'Docs:' }).locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const span = b.locator('p', { hasText: 'The span' }).locator('a[href="#al-diff"]')
  await expect(span).toHaveCount(1)
  await expect(span).toContainText('#al-diff')
})

test('71.4 a tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  const t = tile(page, 'ref-card')
  await expect(t).toContainText('Follows up on #al-diff')
  await expect(t.locator('a')).toHaveCount(0)
  await t.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: 'al-diff' })).toHaveCount(1)
})

test('71.5 fenced code shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', long, '    }', '}']
  werk.cli(['add', 'code-card', '--title', 'Code card', '--body', ['Some text.', '', '```json', ...lines, '```'].join('\n')])
  await tile(page, 'code-card').click()
  const pre = page.getByTestId('card').locator('pre')
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  await expect(pre).toHaveCSS('overflow-x', 'auto')
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const body = page.getByTestId('card').locator('.body')
  const card = page.getByTestId('card')
  const [bw, cw] = [await body.evaluate((el) => el.getBoundingClientRect().width), await card.evaluate((el) => el.getBoundingClientRect().width)]
  expect(bw).toBeLessThanOrEqual(cw)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

// ---------- 72 ----------

/** Cards a, b, c at the root: b depends on a, c depends on b. All decided. */
function chain(werk: Werk, withC = true) {
  real(werk, 'ca', 'Card A')
  real(werk, 'cb', 'Card B')
  decide(werk, 'ca', { noBasis: true })
  werk.cli(['link', 'cb', 'ca', '--type', 'depends_on', '--why', 'B uses A'])
  decide(werk, 'cb')
  if (withC) {
    real(werk, 'cc', 'Card C')
    werk.cli(['link', 'cc', 'cb', '--type', 'depends_on', '--why', 'C uses B'])
    decide(werk, 'cc')
  }
}

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'A is wrong'])
  await page.goto(werk.url)
  const bMark = tile(page, 'cb').locator('.mark')
  await expect(bMark).toHaveText('stale')
  await expect(bMark).toHaveCSS('background-color', RED)
  await expect(tile(page, 'cb')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cb')).toHaveCSS('border-left-color', DECIDED)
  await expect(tile(page, 'cc').locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'Not now'])
  await page.goto(werk.url)
  for (const id of ['cb', 'cc']) {
    const mark = tile(page, id).locator('.mark')
    await expect(mark).toHaveText('paused')
    await expect(mark).toHaveCSS('background-color', GREY)
    await expect(tile(page, id).locator('.mark[data-mark="stale"]')).toHaveCount(0)
  }
  await expect(tile(page, 'cc')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cc')).toHaveCSS('border-left-color', DECIDED)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  chain(werk, false)
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText('was reopened')
  await expect(marks).toContainText('depends_on')
  await expect(marks).toContainText('rejected')
  await expect(marks).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'cc').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText('was reopened')
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  real(werk, 'ca', 'Card A')
  real(werk, 'cx', 'Card X')
  real(werk, 'cb', 'Card B')
  decide(werk, 'ca', { noBasis: true })
  decide(werk, 'cx', { noBasis: true })
  werk.cli(['link', 'cb', 'ca', '--type', 'depends_on', '--why', 'B uses A'])
  werk.cli(['link', 'cb', 'cx', '--type', 'depends_on', '--why', 'B uses X'])
  decide(werk, 'cb')
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'X waits'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'A is wrong'])
  await page.goto(werk.url)
  const mark = tile(page, 'cb').locator('.mark')
  await expect(mark).toHaveText('stale')
  await expect(mark).toHaveCSS('background-color', RED)
  await expect(tile(page, 'cb').locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks).toContainText('Card A')
  await expect(marks.locator('li[data-cause="ca"]')).toHaveAttribute('data-reason', 'rejected')
})
