/** Held-out steps 69.x - 72.x (group mapweb). */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const tile = (page: Page, id: string) => page.locator(`${card(id)} > a`)

const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real card: proposed, then accepted by the person. */
function real(werk: Werk, id: string, title: string, extra: string[] = []) {
  werk.cli(['add', id, '--title', title, ...extra])
  werk.cli(['accept', id, '--actor', 'you'])
}

const rgb = async (l: Locator, prop: string) => {
  const v = await l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
  const m = v.match(/\d+/g)!.map(Number)
  return { r: m[0]!, g: m[1]!, b: m[2]! }
}
const isRed = (c: { r: number; g: number; b: number }) => c.r > 120 && c.r > c.g + 60 && c.r > c.b + 60
const isGrey = (c: { r: number; g: number; b: number }) => Math.abs(c.r - c.g) < 20 && Math.abs(c.g - c.b) < 20

async function expectGhost(l: Locator) {
  await expect(l).toHaveCSS('border-top-style', 'dashed')
  const c = await rgb(l, 'color')
  expect(isGrey(c) && c.r > 90).toBe(true)
}
async function expectReal(l: Locator) {
  await expect(l).not.toHaveCSS('border-top-style', 'dashed')
  const c = await rgb(l, 'color')
  expect(isGrey(c) && c.r > 90).toBe(false)
}

// ---------- 69 ----------

test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  const root = map.locator(`> ${card('werk')}`)
  await expect(root.locator('> a')).toContainText('werk: a visual layer over Claude Code')
  await expect(root.locator(`> ul > ${card('log')}`)).toBeVisible()
  await expect(root.locator(`> ul > ${card('map')}`)).toBeVisible()
  await expect(root.locator(`> ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(root.locator(`> ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(tile(page, 'werk')).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillOpen: true }))
  werk.cli(['add', 'append-only', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'append-only', '--actor', 'you'])
  const drawn = page.locator(`ul[aria-label="map"] > ${card('werk')} > ul > ${card('append-only')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { stillOpen?: boolean }).stillOpen)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await tile(page, 'map').click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail).toContainText('Draw the map in a browser')
  const views = page.locator('.views-pane')
  await expect(views.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(views.getByRole('textbox')).toHaveCount(0)
  await expect(views.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
  await expect(page.getByTestId('card')).toContainText('Draw the map in a browser')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  await expect(tile(page, 'werk')).toBeVisible()
  const before = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const port = new URL(werk.url).port
  const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  const firstPid = lsof.stdout.trim().split('\n')[0]!
  expect(firstPid).toMatch(/^\d+$/)

  const env = { PATH: process.env.PATH ?? '', HOME: tmpdir(), TMPDIR: tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => (out += c.toString()))
  const t0 = Date.now()
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 9000)
    second.once('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const took = Date.now() - t0
  console.log(`second server exit=${code} took=${took}ms output=${out}`)
  expect(out).toMatch(new RegExp(`wait\\w*[^\\n]*${firstPid}`))
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  expect(out).toMatch(/error|refus|already|another/i)
  const lines = out.trim().split('\n')
  expect(lines.slice(1).join('\n')).toContain(firstPid)

  await page.reload()
  await expect(tile(page, 'werk')).toBeVisible()
  const after = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(after).toEqual(before)
})

// ---------- 70 ----------

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  real(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expectGhost(refunds)
  await expectReal(tile(page, 'payments'))
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  real(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await expectGhost(page.locator(`${card('payments')} > ul > ${card('refunds')} > a`))
  await tile(page, 'refunds').click()
  const before = logLines(werk).length
  const tick = page.locator('.views-pane button', { hasText: '✓' })
  await expect(tick).toHaveCount(1)
  await tick.click()
  await expect(tick).toHaveCount(0)
  const lines = logLines(werk)
  const accepts = lines.slice(before).filter((l) => l.type === 'node.accepted')
  expect(accepts.length).toBe(1)
  expect(accepts[0]).toMatchObject({ actor: 'you', payload: { id: 'refunds' } })
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  await expectReal(page.locator(`${card('payments')} > ul > ${card('refunds')} > a`))
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  real(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await tile(page, 'partial').click()
  await page.locator('.views-pane button', { hasText: '✓' }).click()
  await expect(page.locator('.views-pane button', { hasText: '✓' })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  const r = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const p = r.locator(`> ul > ${card('partial')} > a`)
  await expect(p).toContainText('Partial refunds')
  await expectReal(p)
  await expectReal(r.locator('> a'))
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  real(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refund-opt', '--title', 'Refund to the card', '--kind', 'option'])
  werk.cli(['link', 'refund-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refund-src', '--title', 'The card network rules', '--kind', 'source'])
  werk.cli(['link', 'refunds', 'refund-src', '--type', 'supported_by'])
  await expectGhost(tile(page, 'refund-opt'))
  await expectGhost(tile(page, 'refund-src'))
  // The map shows no control that accepts both together.
  await expect(page.locator('.views-pane').getByRole('button')).toHaveCount(0)
  await tile(page, 'refunds').click()
  await expect(page.locator('.views-pane').getByRole('button')).toHaveCount(1)
  await page.locator('.views-pane button', { hasText: '✓' }).click()
  await expect(page.locator('.views-pane button', { hasText: '✓' })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  await expectReal(tile(page, 'refunds'))
  await expectReal(tile(page, 'refund-opt'))
  await expectReal(tile(page, 'refund-src'))
  await expectGhost(tile(page, 'chargebacks'))
  await expect(page.locator('.views-pane').getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  real(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expectGhost(tile(second, 'refunds'))
  await expectGhost(tile(page, 'refunds'))
  await tile(page, 'refunds').click()
  await page.locator('.views-pane button', { hasText: '✓' }).click()
  await expect(tile(second, 'refunds')).not.toHaveCSS('border-top-style', 'dashed', { timeout: 5000 })
  await expectReal(tile(second, 'refunds'))
  await second.close()
})

// ---------- 71 ----------

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  real(werk, 'align', 'Align')
  real(werk, 'notes-card', 'Notes', [
    '--body',
    'See #al-diff and #ghost-card. Then al-diff, and align. Run `node src/cli.ts show #al-diff` now.',
  ])
  await page.goto(`${werk.url}#notes-card`)
  const body = page.getByTestId('card').locator('.body')
  await expect(body).toContainText('#ghost-card')
  await expect(body.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(body.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(body.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(body.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = body.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(body.locator('a code, a:has(code)')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  real(werk, 'pr-iface', 'The PR interface', ['--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  const body = [
    '# al-diff',
    '',
    'Docs: https://example.com/page#al-diff',
    '',
    'The span `#al-diff` names it.',
    '',
    '```',
    '#al-diff',
    '```',
  ].join('\n')
  real(werk, 'doc-card', 'Doc card', ['--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const h = b.getByRole('heading', { name: 'al-diff' })
  await expect(h).toHaveText('al-diff')
  await expect(h.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  await expect(b.locator('a[href="#al-diff"]', { hasText: /^#?al-diff$/ }).filter({ hasNot: page.locator('code') })).toHaveCount(0)
  const urlLinks = await b.locator('a').evaluateAll((as) => as.map((a) => a.textContent))
  expect(urlLinks.some((t) => t?.includes('example.com') === false && t === 'al-diff')).toBe(false)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const spanLink = b.locator('a:has(code), code a').filter({ hasText: '#al-diff' })
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toHaveAttribute('href', /#al-diff$/)
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  real(werk, 'ref-card', 'Follows up on #al-diff')
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const t = tile(page, 'ref-card')
  await expect(t).toContainText('Follows up on #al-diff')
  await expect(t.locator('a')).toHaveCount(0)
  await t.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": 1,', long, '    }', '}']
  real(werk, 'code-card', 'Code card', ['--body', ['Some text.', '', '```json', ...lines, '```'].join('\n')])
  await page.goto(`${werk.url}#code-card`)
  const art = page.getByTestId('card')
  const pre = art.locator('.body pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  const colours = await pre.locator('span').evaluateAll((ss) => new Set(ss.map((s) => getComputedStyle(s).color)).size)
  expect(colours).toBeGreaterThan(1)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const scrolled = await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
    return el.scrollLeft
  })
  expect(scrolled).toBeGreaterThan(0)
  const bodyFits = await art.evaluate((a) => {
    const b = a.querySelector('.body') as HTMLElement
    return b.scrollWidth <= a.clientWidth + 1 && b.getBoundingClientRect().width <= a.getBoundingClientRect().width + 1
  })
  expect(bodyFits).toBe(true)
})

// ---------- 72 ----------

/** Real cards with the given depends_on links, then each made decided with every fact it needs. */
function decidedCards(werk: Werk, cards: [string, string][], deps: [string, string][]) {
  for (const [id, t] of cards) real(werk, id, t)
  for (const [from, to] of deps) werk.cli(['link', from, to, '--type', 'depends_on'])
  for (const [id] of cards) {
    werk.cli(['edit', id, '--who', 'me'])
    if (!deps.some(([from]) => from === id)) werk.cli(['edit', id, '--no-basis', 'A root decision'])
    werk.cli(['kill', id, '--form', 'manual', '--text', 'Check it by use'])
    werk.cli(['status', id, 'decided', '--unchallenged'])
  }
}

/** A, B depends on A, C depends on B; every card real and decided. */
function chain(werk: Werk) {
  decidedCards(
    werk,
    [
      ['card-a', 'Card A'],
      ['card-b', 'Card B'],
      ['card-c', 'Card C'],
    ],
    [
      ['card-b', 'card-a'],
      ['card-c', 'card-b'],
    ],
  )
}
const mark = (page: Page, id: string, kind: string) => page.locator(`${card(id)} > a .mark`, { hasText: kind })

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The idea was wrong'])
  await page.goto(werk.url)
  await expect(mark(page, 'card-b', 'stale')).toBeVisible()
  expect(isRed(await rgb(mark(page, 'card-b', 'stale'), 'background-color'))).toBe(true)
  await expect(tile(page, 'card-b')).toHaveAttribute('data-status', 'decided')
  const decided = await rgb(tile(page, 'card-b'), 'border-left-color')
  expect(isGrey(decided) && decided.r === 0 && decided.g === 0).toBe(false)
  await expect(page.locator(`${card('card-c')} > a .mark`)).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  chain(werk)
  // Reference: the decided colour of an unmarked card.
  await expect(tile(page, 'card-c')).toHaveAttribute('data-status', 'decided')
  const colourBefore = await tile(page, 'card-c').evaluate((a) => getComputedStyle(a).borderLeftColor)
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'Later'])
  await page.goto(werk.url)
  await expect(mark(page, 'card-b', 'paused')).toBeVisible()
  await expect(mark(page, 'card-c', 'paused')).toBeVisible()
  expect(isGrey(await rgb(mark(page, 'card-b', 'paused'), 'background-color'))).toBe(true)
  expect(isGrey(await rgb(mark(page, 'card-c', 'paused'), 'background-color'))).toBe(true)
  await expect(tile(page, 'card-c')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'card-c')).toHaveCSS('border-left-color', colourBefore)
  await expect(mark(page, 'card-b', 'stale')).toHaveCount(0)
  await expect(mark(page, 'card-c', 'stale')).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'card-b').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading')).toContainText('Why this card is stale')
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText(/reopened/)
  await expect(marks).toContainText('depends_on')
  await expect(marks).toContainText('rejected')
  await expect(marks).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'card-c').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading')).toContainText('Why this card is stale')
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText(/reopened/)
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decidedCards(
    werk,
    [
      ['card-a', 'Card A'],
      ['card-x', 'Card X'],
      ['card-b', 'Card B'],
    ],
    [
      ['card-b', 'card-a'],
      ['card-b', 'card-x'],
    ],
  )
  werk.cli(['reopen', 'card-x', '--reason', 'postponed', '--why', 'Not now'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'Wrong idea'])
  await page.goto(werk.url)
  await expect(mark(page, 'card-b', 'stale')).toBeVisible()
  expect(isRed(await rgb(mark(page, 'card-b', 'stale'), 'background-color'))).toBe(true)
  await expect(mark(page, 'card-b', 'paused')).toHaveCount(0)
  await tile(page, 'card-b').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText('rejected')
})
