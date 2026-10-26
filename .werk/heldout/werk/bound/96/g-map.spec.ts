/** Held-out steps 69.x, 70.x, 71.x and 72.x: the map in a browser. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const GREY = 'rgb(138, 138, 138)'
const RED = 'rgb(179, 38, 30)'
const MARK_GREY = 'rgb(117, 117, 117)'

const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real card under the fixture's decided root, with a decider and a kill criterion. */
function realCard(werk: Werk, id: string, title: string, parent = 'werk') {
  werk.cli(['add', id, '--title', title, '--parent', parent, '--who', 'me'])
  werk.cli(['kill', id, '--form', 'manual', '--text', 'check by use'])
  werk.cli(['accept', id, '--actor', 'you'])
}
const decide = (werk: Werk, id: string) => werk.cli(['status', id, 'decided', '--unchallenged'])

async function openMap(page: Page, werk: Werk) {
  await page.goto(werk.url)
  await expect(page.getByRole('list', { name: 'map' })).toBeVisible()
}

// ---------- 69 ----------

test('69.1 the map shows a refines tree with a grandchild under its own parent', async ({ page, werk }) => {
  werk.cli(['add', 'root', '--title', 'Root card'])
  werk.cli(['accept', 'root', '--actor', 'you'])
  for (const [id, parent] of [['kid1', 'root'], ['kid2', 'root'], ['grand', 'kid1']]) {
    werk.cli(['add', id, '--title', `Card ${id}`, '--parent', parent])
    werk.cli(['accept', id, '--actor', 'you'])
  }
  await openMap(page, werk)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('root')} > a`)).toContainText('Root card')
  await expect(map.locator(`> ${card('root')} > ul > ${card('kid1')}`)).toBeVisible()
  await expect(map.locator(`> ${card('root')} > ul > ${card('kid2')}`)).toBeVisible()
  await expect(map.locator(`> ${card('root')} > ul > ${card('kid1')} > ul > ${card('grand')}`)).toBeVisible()
  await expect(map.locator(`> ${card('root')} > ul > ${card('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted on the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.getByRole('list', { name: 'map' })).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutStillOpen: true }))
  werk.cli(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aol', '--actor', 'you'])
  const drawn = page.locator(`ul[aria-label="map"] > ${card('werk')} > ul > ${card('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutStillOpen?: boolean }).heldoutStillOpen)).toBe(true)
})

test('69.3 the open card is in the address bar, has no text edit control, and survives a reload', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
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

test('69.4 a second server on the same project stops, and the map still loads from the first', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li')).toHaveCount(7)
  const before = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const t0 = Date.now()
  const code = await werk.start(['serve', '--port', '0']).exited
  const took = Date.now() - t0
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8000)
  await page.goto(werk.url)
  await expect(map.locator('li')).toHaveCount(7)
  expect(await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))).toEqual(before)
})

// ---------- 70 ----------

test('70.1 a proposed card shows grey and dashed under its proposed parent', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await openMap(page, werk)
  const ghost = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('color', GREY)
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  const real = page.locator(`${card('payments')} > a`)
  await expect(real).not.toHaveCSS('color', GREY)
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.2 the ✓ button accepts one ghost and it becomes real', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await openMap(page, werk)
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  const before = logLines(werk).length
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await openMap(page, werk)
  await page.locator(`${card('partial')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted branch', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refund-opt', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'Users want money back'])
  werk.cli(['link', 'refund-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refund-src', '--kind', 'source', '--title', 'Refund policy doc'])
  werk.cli(['link', 'refunds', 'refund-src', '--type', 'supported_by'])
  await openMap(page, werk)
  // The map view itself has no control that accepts many ghosts together.
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refund-opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refund-src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const cb = page.locator(`${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second window sees the accept', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await openMap(page, werk)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})

// ---------- 71 ----------

function aliases(werk: Werk) {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment', '--parent', 'werk'])
  werk.cli(['add', 'align', '--title', 'Align', '--parent', 'werk'])
}

test('71.1 known ids in a body become links, other text stays plain', async ({ page, werk }) => {
  aliases(werk)
  const body = 'See #al-diff and #ghost-card. Also al-diff and align. Run `node src/cli.ts show #al-diff` now.'
  werk.cli(['add', 'notes-card', '--title', 'Notes card', '--parent', 'werk', '--body', body])
  await openMap(page, werk)
  await page.locator(`${card('notes-card')} > a`).click()
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('See #al-diff and #ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a', { hasText: 'node src/cli.ts' })).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  aliases(werk)
  werk.cli(['add', 'pr-iface', '--title', 'PR interface', '--parent', 'werk', '--why', 'It builds on #al-diff.'])
  await openMap(page, werk)
  await page.locator(`${card('pr-iface')} > a`).click()
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their form, a code span links', async ({ page, werk }) => {
  aliases(werk)
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc card', '--parent', 'werk', '--body', body])
  await openMap(page, werk)
  await page.locator(`${card('doc-card')} > a`).click()
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  const cardLinks = b.locator('a[href="#al-diff"]')
  for (const a of await cardLinks.all()) {
    const inUrl = await a.evaluate((el) => (el.previousSibling?.textContent ?? '').endsWith('page'))
    expect(inUrl).toBe(false)
  }
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const spanLink = b.locator('p', { hasText: 'The span' }).locator('a[href="#al-diff"]')
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toContainText('#al-diff')
})

test('71.4 a tile title with an id holds no link, a note on the open card does', async ({ page, werk }) => {
  aliases(werk)
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff', '--parent', 'werk'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await openMap(page, werk)
  const tile = page.locator(`${card('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

test('71.5 fenced code is boxed, highlighted, keeps indentation and scrolls sideways', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": 1,', long, '    }', '}']
  werk.cli(['add', 'code-card', '--title', 'Code card', '--parent', 'werk', '--body', ['Some text.', '', '```json', ...lines, '```'].join('\n')])
  await openMap(page, werk)
  await page.locator(`${card('code-card')} > a`).click()
  const pre = page.getByTestId('card').locator('.body pre')
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('[class^="tok-"], [class*=" tok-"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const scrolled = await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
    return el.scrollLeft
  })
  expect(scrolled).toBeGreaterThan(0)
  const bodyFits = await page.getByTestId('card').locator('.body').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(bodyFits).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

// ---------- 72 ----------

/** Cards a, b and c under the root; b depends on a, c on b; all decided. */
function chain(werk: Werk, ids: string[]) {
  for (const id of ids) realCard(werk, id, `Card ${id.toUpperCase()}`)
  for (let i = 1; i < ids.length; i++) werk.cli(['link', ids[i]!, ids[i - 1]!, '--type', 'depends_on'])
  for (const id of ids) decide(werk, id)
}

const tile = (page: Page, id: string) => page.locator(`${card(id)} > a`)

test('72.1 a rejected reopen marks only the direct dependent red', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb', 'cc'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await openMap(page, werk)
  const mark = tile(page, 'cb').locator('.mark')
  await expect(mark).toHaveText('stale')
  await expect(mark).toHaveCSS('background-color', RED)
  await expect(tile(page, 'cb')).toHaveAttribute('data-status', 'decided')
  expect(await tile(page, 'cb').evaluate((a) => getComputedStyle(a).borderLeftColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(tile(page, 'cc').locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card grey and keeps the status colour', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb', 'cc'])
  await openMap(page, werk)
  const colour = await tile(page, 'cc').evaluate((a) => getComputedStyle(a).borderLeftColor)
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(werk.url)
  for (const id of ['cb', 'cc']) {
    const mark = tile(page, id).locator('.mark')
    await expect(mark).toHaveText('paused')
    await expect(mark).toHaveCSS('background-color', MARK_GREY)
    await expect(tile(page, id).locator('.mark[data-mark="stale"]')).toHaveCount(0)
  }
  await expect(tile(page, 'cc')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cc')).toHaveCSS('border-left-color', colour)
})

test('72.3 the card view of a stale card explains the change, the link and the reason', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await openMap(page, werk)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('was reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb', 'cc'])
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await openMap(page, werk)
  await tile(page, 'cc').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('was reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  realCard(werk, 'ca', 'Card A')
  realCard(werk, 'cx', 'Card X')
  realCard(werk, 'cb', 'Card B')
  werk.cli(['link', 'cb', 'ca', '--type', 'depends_on'])
  werk.cli(['link', 'cb', 'cx', '--type', 'depends_on'])
  for (const id of ['ca', 'cx', 'cb']) decide(werk, id)
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'Wrong'])
  await openMap(page, werk)
  const mark = tile(page, 'cb').locator('.mark')
  await expect(mark).toHaveCount(1)
  await expect(mark).toHaveText('stale')
  await expect(mark).toHaveCSS('background-color', RED)
  await expect(tile(page, 'cb').locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('rejected')
})
