/** Held-out steps 69.1–72.5: the map in the browser. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real decided card under #werk, with every fact the decide check asks for. */
function decided(werk: Werk, id: string, deps: string[] = []) {
  werk.cli(['add', id, '--title', `Card ${id.toUpperCase()}`, '--parent', 'werk', '--who', 'me'])
  werk.cli(['add', `${id}-alt`, '--kind', 'option', '--title', `Another way for ${id}`, '--why-not', 'It costs more'])
  werk.cli(['link', `${id}-alt`, id, '--type', 'alternative_to'])
  werk.cli(['kill', id, '--form', 'manual', '--text', `check ${id} by use`])
  for (const d of deps) werk.cli(['link', id, d, '--type', 'depends_on', '--why', `${id} needs ${d}`])
  werk.cli(['accept', id, '--actor', 'you'])
  werk.cli(['status', id, 'decided'])
}

// ---------- 69 ----------

test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('werk')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('map')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { notReloaded: true }))
  werk.cli(['add', 'aolog', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aolog', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aolog')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  const views = page.locator('.views-pane')
  await expect(views.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(views.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  const firstPid = (JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }).pid
  const env = { ...process.env }
  delete env.WERK_LOG
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => (out += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 15_000)
    second.once('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const took = Date.now() - started
  console.log(out, code, took)
  expect(out).toContain(`waiting for pid ${firstPid}`)
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8_000)
  expect(out).toMatch(new RegExp(`(refus|already|error)[\\s\\S]*${firstPid}|${firstPid}[\\s\\S]*(refus|already|error)`, 'i'))
  await page.goto(werk.url)
  await expect(page.getByRole('list', { name: 'map' }).locator('li')).toHaveCount(7)
})

// ---------- 70 ----------

function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const ghost = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  await expect(ghost).toHaveCSS('color', 'rgb(138, 138, 138)')
  const real = page.locator(`${card('payments')} > a`)
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
  await expect(real).not.toHaveCSS('color', 'rgb(138, 138, 138)')
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(`${werk.url}#refunds`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  const before = logLines(werk).length
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0)
  await page.goto(werk.url)
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial-refunds', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial-refunds`)
  await page.getByRole('button', { name: 'Accept #partial-refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial-refunds')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Refund by hand', '--why-not', 'Too slow'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(`${werk.url}#refunds`)
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  expect(werk.cli(['show', 'refunds-opt'])).toContain('state: real')
  expect(werk.cli(['show', 'refunds-src'])).toContain('state: real')
  await page.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  const cb = page.locator(`${card('payments')} > ul > ${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', 'rgb(138, 138, 138)')
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  const second = await page.context().newPage()
  await page.goto(werk.url)
  await second.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})

// ---------- 71 ----------

function alDiff(werk: Werk) {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment', '--parent', 'werk'])
  werk.cli(['add', 'align', '--title', 'Align the cards', '--parent', 'werk'])
}

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  alDiff(werk)
  const body = 'See #al-diff and #ghost-card, then al-diff and align.\n\nRun `node src/cli.ts show #al-diff` to print it.'
  werk.cli(['add', 'notes-card', '--title', 'Notes', '--parent', 'werk', '--body', body])
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
  await expect(b.locator('a', { has: page.locator('code') })).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  alDiff(werk)
  werk.cli(['add', 'pr-iface', '--title', 'PR interface', '--parent', 'werk', '--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  alDiff(werk)
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'A span: `#al-diff`.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc', '--parent', 'werk', '--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  // No card link sits inside or as part of the URL.
  const cardLinks = b.locator('a[href="#al-diff"]')
  for (const a of await cardLinks.all()) expect(await a.evaluate((el) => el.parentElement?.textContent?.includes('example.com/page') && !el.closest('code'))).toBeFalsy()
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const spanLink = b.locator('a[href="#al-diff"]', { has: page.locator('code') }).or(b.locator('code a[href="#al-diff"]'))
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toContainText('#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  alDiff(werk)
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff', '--parent', 'werk'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator(`${card('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

const LONG_LINE = `        "deep": "${'x'.repeat(400)}"`
const CODE = ['Some prose before the code.', '', '```json', '{', '    "a": {', LONG_LINE, '    }', '}', '```'].join('\n')

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  werk.cli(['add', 'code-card', '--title', 'A card with code', '--parent', 'werk', '--body', CODE])
  await page.goto(`${werk.url}#code-card`)
  const article = page.getByTestId('card')
  const pre = article.locator('pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(['{', '    "a": {', LONG_LINE, '    }', '}'].join('\n'))
  await expect(pre).toHaveCSS('overflow-x', /auto|scroll/)
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const body = article.locator('.body')
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await article.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

// ---------- 72 ----------

const STALE_RED = 'rgb(179, 38, 30)'
const PAUSED_GREY = 'rgb(117, 117, 117)'
const DECIDED_GREEN = 'rgb(46, 125, 50)'

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  decided(werk, 'cc', ['cb'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  const b = page.locator(`${card('cb')} > a`)
  await expect(b.locator('.mark')).toHaveText('stale')
  await expect(b.locator('.mark')).toHaveCSS('background-color', STALE_RED)
  await expect(b).toHaveAttribute('data-status', 'decided')
  await expect(b).toHaveCSS('border-left-color', DECIDED_GREEN)
  const c = page.locator(`${card('cc')} > a`)
  await expect(c).toBeVisible()
  await expect(c.locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  decided(werk, 'cc', ['cb'])
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(werk.url)
  for (const id of ['cb', 'cc']) {
    const m = page.locator(`${card(id)} > a .mark`)
    await expect(m).toHaveText('paused')
    await expect(m).toHaveCSS('background-color', PAUSED_GREY)
    await expect(page.locator(`${card(id)} > a .mark[data-mark="stale"]`)).toHaveCount(0)
  }
  const c = page.locator(`${card('cc')} > a`)
  await expect(c).toHaveAttribute('data-status', 'decided')
  await expect(c).toHaveCSS('border-left-color', DECIDED_GREEN)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await page.locator(`${card('cb')} > a`).click()
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
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  decided(werk, 'cc', ['cb'])
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await page.locator(`${card('cc')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('was reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decided(werk, 'ca')
  decided(werk, 'cx')
  decided(werk, 'cb', ['ca', 'cx'])
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'Wrong choice'])
  await page.goto(werk.url)
  const b = page.locator(`${card('cb')} > a`)
  await expect(b.locator('.mark')).toHaveText('stale')
  await expect(b.locator('.mark')).toHaveCSS('background-color', STALE_RED)
  await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await b.click()
  const marks = page.getByRole('region', { name: 'marks' })
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('rejected')
})
