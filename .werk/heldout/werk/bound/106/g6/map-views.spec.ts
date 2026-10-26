/** Held-out steps 69.1-69.4, 70.x, 71.x, 72.x: the map in a browser. */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real card, accepted by the person. */
const realCard = (werk: Werk, id: string, title: string, parent?: string) => {
  werk.cli(['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
  werk.cli(['accept', id, '--actor', 'you'])
}
/** A real decided card under #werk, with the facts the decide check asks for. */
const decidedCard = (werk: Werk, id: string, title: string, dependsOn: string[] = []) => {
  werk.cli(['add', id, '--title', title, '--who', 'me', '--parent', 'werk'])
  werk.cli(['accept', id, '--actor', 'you'])
  for (const d of dependsOn) werk.cli(['link', id, d, '--type', 'depends_on', '--why', `${id} takes ${d}`])
  werk.cli(['kill', id, '--form', 'revisit'])
  werk.cli(['status', id, 'decided'])
}

// ---------- 69 ----------

test('69.1 the map shows the fixture project as a refines tree', async ({ page, werk }) => {
  realCard(werk, 'root-card', 'The root card')
  realCard(werk, 'child-one', 'The first child', 'root-card')
  realCard(werk, 'child-two', 'The second child', 'root-card')
  realCard(werk, 'grandchild', 'The grandchild', 'child-one')
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('root-card')} > a`)).toContainText('The root card')
  await expect(map.locator(`> ${card('root-card')} > ul > ${card('child-one')}`)).toBeVisible()
  await expect(map.locator(`> ${card('root-card')} > ul > ${card('child-two')}`)).toBeVisible()
  await expect(map.locator(`> ${card('root-card')} > ul > ${card('child-one')} > ul > ${card('grandchild')}`)).toBeVisible()
  await expect(map.locator(`> ${card('root-card')} > ul > ${card('grandchild')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillOpen: true }))
  werk.cli(['add', 'append-only', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'append-only', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('append-only')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { stillOpen?: boolean }).stillOpen)).toBe(true)
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
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
  await expect(page).toHaveURL(/#map$/)
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(card('werk'))).toBeVisible()
  const before = await map.locator('li').count()
  const firstPid = spawnSync('pgrep', ['-f', werk.app.testServer], { encoding: 'utf8' }).stdout.trim().split('\n')[0]
  expect(firstPid).toMatch(/^\d+$/)

  const bin = join(dirname(werk.dir), 'bin')
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: dirname(werk.dir), TMPDIR: process.env.TMPDIR ?? '/tmp' }
  const t0 = Date.now()
  const second = spawn('bun', [werk.app.main, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  second.stderr.on('data', (c: Buffer) => (err += c.toString()))
  second.stdout.on('data', (c: Buffer) => (err += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 15_000)
    second.once('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const took = Date.now() - t0
  expect(err).toContain(`waiting for pid ${firstPid}`)
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  const errorLines = err.split('\n').filter((l) => !l.includes('waiting'))
  expect(errorLines.join('\n')).toContain(firstPid!)

  await page.goto(werk.url)
  await expect(map.locator(card('werk'))).toBeVisible()
  await expect(map.locator('li')).toHaveCount(before)
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
  await expect(page.getByRole('button', { name: 'Accept #refunds' })).toHaveCount(0)
  await page.goto(werk.url)
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial-refunds', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial-refunds`)
  await page.getByRole('button', { name: 'Accept #partial-refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial-refunds')}`)).toHaveAttribute('data-proposed', 'false')
})

test('70.4 an accept takes only the accepted card\'s branch, not other ghosts', async ({ page, werk }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'customers want money back'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(`${werk.url}#refunds`)
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const charge = page.locator(`${card('chargebacks')} > a`)
  await expect(charge).toHaveCSS('border-top-style', 'dashed')
  await expect(charge).toHaveCSS('color', 'rgb(138, 138, 138)')
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk, context }) => {
  realCard(werk, 'payments', 'Payments')
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(`${werk.url}#refunds`)
  const second = await context.newPage()
  await second.goto(werk.url)
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})

// ---------- 71 ----------

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment', 'werk')
  realCard(werk, 'align', 'Align', 'werk')
  const body = 'Mentions #al-diff and #ghost-card, then al-diff and align.\n\nRun `node src/cli.ts show #al-diff` to print it.'
  werk.cli(['add', 'notes-card', '--title', 'Notes', '--parent', 'werk', '--body', body])
  await page.goto(`${werk.url}#notes-card`)
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('Mentions #al-diff')
  const links = b.locator('a')
  await expect(links.filter({ hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(links.filter({ hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(links.filter({ hasText: 'ghost-card' })).toHaveCount(0)
  await expect(links.filter({ hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a', { has: page.locator('code', { hasText: 'node src/cli.ts' }) })).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment', 'werk')
  werk.cli(['add', 'pr-iface', '--title', 'The PR interface', '--parent', 'werk', '--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment', 'werk')
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc', '--parent', 'werk', '--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveCount(1)
  await expect(heading.locator('a')).toHaveCount(0)
  const urlPara = b.locator('p', { hasText: 'example.com' })
  await expect(urlPara.locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(urlPara.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const spanPara = b.locator('p', { hasText: 'The span' })
  await expect(spanPara.locator('a[href="#al-diff"]')).toHaveCount(1)
  await expect(spanPara.locator('a[href="#al-diff"]')).toHaveText('#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  realCard(werk, 'al-diff', 'Diff the alignment', 'werk')
  realCard(werk, 'ref-card', 'Follows up on #al-diff', 'werk')
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

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const LONG = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": {', LONG, '        }', '    }', '}']
  werk.cli(['add', 'code-card', '--title', 'Code', '--parent', 'werk', '--body', ['```json', ...lines, '```'].join('\n')])
  await page.goto(`${werk.url}#code-card`)
  const pre = page.getByTestId('card').locator('pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class*="tok"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  await expect(pre).toHaveCSS('white-space', /pre/)
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const scrolled = await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
    return el.scrollLeft > 0
  })
  expect(scrolled).toBe(true)
  const body = page.getByTestId('card').locator('.body')
  const fits = await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(fits).toBe(true)
  const cardFits = await page.getByTestId('card').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(cardFits).toBe(true)
})

// ---------- 72 ----------

const markOf = (page: import('@playwright/test').Page, id: string) => page.locator(`${card(id)} > a .mark`)

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-b', 'Card B', ['card-a'])
  decidedCard(werk, 'card-c', 'Card C', ['card-b'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  await expect(markOf(page, 'card-b')).toHaveText('stale')
  await expect(markOf(page, 'card-b')).toHaveCSS('background-color', 'rgb(179, 38, 30)')
  await expect(page.locator(`${card('card-b')} > a`)).toHaveAttribute('data-status', 'decided')
  await expect(page.locator(`${card('card-b')} > a`)).toHaveCSS('border-left-color', 'rgb(46, 125, 50)')
  await expect(markOf(page, 'card-c')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-b', 'Card B', ['card-a'])
  decidedCard(werk, 'card-c', 'Card C', ['card-b'])
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(werk.url)
  for (const id of ['card-b', 'card-c']) {
    await expect(markOf(page, id)).toHaveText('paused')
    await expect(markOf(page, id)).toHaveCSS('background-color', 'rgb(117, 117, 117)')
  }
  await expect(page.locator(`${card('card-c')} > a`)).toHaveAttribute('data-status', 'decided')
  await expect(page.locator(`${card('card-c')} > a`)).toHaveCSS('border-left-color', 'rgb(46, 125, 50)')
  await expect(page.locator(`${card('card-b')} > a .mark[data-mark="stale"]`)).toHaveCount(0)
  await expect(page.locator(`${card('card-c')} > a .mark[data-mark="stale"]`)).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-b', 'Card B', ['card-a'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await page.locator(`${card('card-b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="card-a"]')
  await expect(trace).toContainText('#card-a')
  await expect(trace).toContainText('was reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-b', 'Card B', ['card-a'])
  decidedCard(werk, 'card-c', 'Card C', ['card-b'])
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await page.locator(`${card('card-c')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="card-a"]')
  await expect(trace).toContainText('#card-a')
  await expect(trace).toContainText('was reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-x', 'Card X')
  decidedCard(werk, 'card-b', 'Card B', ['card-a', 'card-x'])
  werk.cli(['reopen', 'card-x', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(werk.url)
  await expect(markOf(page, 'card-b')).toHaveText('stale')
  await expect(markOf(page, 'card-b')).toHaveCSS('background-color', 'rgb(179, 38, 30)')
  await expect(page.locator(`${card('card-b')} > a .mark[data-mark="paused"]`)).toHaveCount(0)
  await page.locator(`${card('card-b')} > a`).click()
  const trace = page.getByRole('region', { name: 'marks' }).locator('li[data-cause="card-a"]')
  await expect(trace).toContainText('rejected')
})
