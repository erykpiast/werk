/** Held-out steps 69.1–69.4, 70.x, 71.x, 72.x: the map in a browser. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real card under `parent`, accepted by the person. */
function realCard(werk: Werk, id: string, title: string, parent = 'werk', extra: string[] = []) {
  werk.cli(['add', id, '--title', title, '--parent', parent, ...extra])
  werk.cli(['accept', id, '--actor', 'you'])
}
/** Gives a real card the facts it needs and decides it. */
function decide(werk: Werk, id: string) {
  werk.cli(['edit', id, '--who', 'you'])
  werk.cli(['kill', id, '--form', 'manual', '--text', `check ${id}`])
  werk.cli(['status', id, 'decided', '--unchallenged'])
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
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'aolog', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aolog', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aolog')}`)
  await expect(drawn).toContainText('Use an append-only log')
  await expect(drawn).toHaveAttribute('data-proposed', 'false')
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
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
  test.setTimeout(30_000)
  await expect(page.locator(card('werk'))).toBeVisible()
  const env = { ...process.env, PATH: `${join(werk.dir, '..', 'bin')}:${process.env.PATH}`, HOME: join(werk.dir, '..') }
  delete (env as Record<string, string | undefined>).WERK_LOG
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
  const pids = [...out.matchAll(/\b(\d{2,7})\b/g)].map((m) => m[1])
  console.log('second server output:', out, 'code', code, 'took', took)
  expect(out).toMatch(/wait/i)
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(9_000)
  // The first server's pid is in the lock file beside the log.
  const lockFiles = (await import('node:fs')).readdirSync(join(werk.dir, '.werk'))
  const lockName = lockFiles.find((f) => /lock/.test(f))
  expect(lockName).toBeDefined()
  const firstPid = readFileSync(join(werk.dir, '.werk', lockName!), 'utf8').match(/\d+/)![0]
  expect(pids).toContain(firstPid)
  expect(out.split('\n').filter((l) => /wait/i.test(l)).join('\n')).toContain(firstPid)
  await page.reload()
  await expect(page.getByRole('list', { name: 'map' }).locator('li')).toHaveCount(7)
})

// ---------- 70 ----------
test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
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
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(`${werk.url}#refunds`)
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
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial`)
  await page.getByRole('button', { name: 'Accept #partial' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial')}`)).toHaveAttribute('data-proposed', 'false')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds:opt', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'Customers want money back'])
  werk.cli(['link', 'refunds:opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(`${werk.url}#refunds`)
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds:opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const cb = page.locator(`${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', 'rgb(138, 138, 138)')
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await page.goto(`${werk.url}#refunds`)
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})

// ---------- 71 ----------
test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment')
  realCard(werk, 'align', 'Align')
  const body = 'See #al-diff and #ghost-card, then al-diff and align.\n\nRun `node src/cli.ts show #al-diff` here.'
  realCard(werk, 'notes-card', 'Notes', 'werk', ['--body', body])
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
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment')
  realCard(werk, 'pr-iface', 'The PR interface', 'werk', ['--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment')
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'Span: `#al-diff`', '', '```', '#al-diff', '```'].join('\n')
  realCard(werk, 'doc-card', 'Doc', 'werk', ['--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveCount(1)
  await expect(heading.locator('a')).toHaveCount(0)
  // The URL fragment is not a card link: no link in the body points at the card from the URL text.
  const urlLinks = b.locator('a[href="#al-diff"]', { hasText: /example\.com|^al-diff$/ })
  await expect(urlLinks).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  const span = b.locator('a[href="#al-diff"]', { hasText: '#al-diff' })
  await expect(span).toHaveCount(1)
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment')
  realCard(werk, 'ref-card', 'Follows up on #al-diff')
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator(`${card('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  await expect(page.getByRole('region', { name: 'notes' }).locator('a', { hasText: 'al-diff' })).toHaveCount(1)
})

test('71.5 fenced code shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "a": {', long, '    }', '}']
  realCard(werk, 'code-card', 'Code', 'werk', ['--body', ['Some text before.', '', '```json', ...lines, '```'].join('\n')])
  await page.goto(`${werk.url}#code-card`)
  const pre = page.getByTestId('card').locator('pre')
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  await expect(pre.locator('[class*="tok"]').first()).toBeVisible()
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  await expect(pre).toHaveCSS('overflow-x', /auto|scroll/)
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const body = page.getByTestId('card').locator('.body')
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  const art = page.getByTestId('card')
  expect(await art.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})

// ---------- 72 ----------
function chain(werk: Werk, ids: string[], decidedIds: string[]) {
  for (const id of ids) realCard(werk, id, `Card ${id}`)
  for (let i = 1; i < ids.length; i++) werk.cli(['link', ids[i]!, ids[i - 1]!, '--type', 'depends_on'])
  for (const id of decidedIds) decide(werk, id)
}
const tile = (page: import('@playwright/test').Page, id: string) => page.locator(`${card(id)} > a`)

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb', 'cc'], ['ca', 'cb', 'cc'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  const mark = tile(page, 'cb').locator('.mark')
  await expect(mark).toHaveText('stale')
  await expect(mark).toHaveCSS('background-color', 'rgb(179, 38, 30)')
  await expect(tile(page, 'cb')).toHaveAttribute('data-status', 'decided')
  const decidedColour = await tile(page, 'cc').evaluate((a) => getComputedStyle(a).borderLeftColor)
  await expect(tile(page, 'cb')).toHaveCSS('border-left-color', decidedColour)
  await expect(tile(page, 'cc').locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb', 'cc'], ['ca', 'cb', 'cc'])
  realCard(werk, 'cref', 'A decided reference')
  decide(werk, 'cref')
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(werk.url)
  for (const id of ['cb', 'cc']) {
    await expect(tile(page, id).locator('.mark')).toHaveText('paused')
    await expect(tile(page, id).locator('.mark')).toHaveCSS('background-color', 'rgb(117, 117, 117)')
  }
  await expect(tile(page, 'cc')).toHaveAttribute('data-status', 'decided')
  const decidedColour = await tile(page, 'cref').evaluate((a) => getComputedStyle(a).borderLeftColor)
  await expect(tile(page, 'cc')).toHaveCSS('border-left-color', decidedColour)
  await expect(page.locator('.mark', { hasText: 'stale' })).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb'], ['ca', 'cb'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk, ['ca', 'cb', 'cc'], ['ca'])
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'cc').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  for (const id of ['ca', 'cx', 'cb']) realCard(werk, id, `Card ${id}`)
  werk.cli(['link', 'cb', 'ca', '--type', 'depends_on'])
  werk.cli(['link', 'cb', 'cx', '--type', 'depends_on'])
  for (const id of ['ca', 'cx', 'cb']) decide(werk, id)
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(werk.url)
  await expect(tile(page, 'cb').locator('.mark')).toHaveText('stale')
  await expect(tile(page, 'cb').locator('.mark')).toHaveCSS('background-color', 'rgb(179, 38, 30)')
  await expect(tile(page, 'cb').locator('.mark', { hasText: 'paused' })).toHaveCount(0)
  await tile(page, 'cb').click()
  const trace = page.getByRole('region', { name: 'marks' }).locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('rejected')
})
