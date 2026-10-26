/** Held-out steps 69, 70, 71, 72: the map in a browser. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const tile = (page: Page, id: string) => page.locator(`${card(id)} > a`)
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'

const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real decided card under the decided card "log", with every contract fact. */
function decided(werk: Werk, id: string, deps: string[] = []) {
  werk.cli(['add', id, '--title', `Card ${id}`, '--parent', 'log', '--who', 'prototype'])
  werk.cli(['kill', id, '--form', 'manual', '--text', 'check by use'])
  for (const d of deps) werk.cli(['link', id, d, '--type', 'depends_on', '--why', `needs ${d}`])
  werk.cli(['accept', id, '--actor', 'you'])
  werk.cli(['status', id, 'decided'])
}

// ---------------------------------------------------------------- 69

test('69.1 the map shows the fixture project as a refines tree', async ({ page, werk }) => {
  // Given a project with a root card, two child cards that refine the root, and one grandchild card that refines a child
  werk.cli(['add', 'root', '--title', 'Root card'])
  werk.cli(['add', 'kid1', '--title', 'Child one', '--parent', 'root'])
  werk.cli(['add', 'kid2', '--title', 'Child two', '--parent', 'root'])
  werk.cli(['add', 'grand', '--title', 'Grandchild', '--parent', 'kid1'])
  werk.cli(['accept', 'grand', '--actor', 'you'])
  werk.cli(['accept', 'kid2', '--actor', 'you'])
  // And the person starts the server on that project / When the person opens the map in a browser
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  // Then the person sees the root card
  await expect(map.locator(`> ${card('root')} > a`)).toContainText('Root card')
  // And the person sees the two child cards under the root card
  await expect(map.locator(`> ${card('root')} > ul > ${card('kid1')} > a`)).toContainText('Child one')
  await expect(map.locator(`> ${card('root')} > ul > ${card('kid2')} > a`)).toContainText('Child two')
  // And the person sees the grandchild card under its parent card, not under the root card
  await expect(map.locator(`> ${card('root')} > ul > ${card('kid1')} > ul > ${card('grand')} > a`)).toContainText('Grandchild')
  await expect(map.locator(`> ${card('root')} > ul > ${card('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  // Given the server runs on a project, and the person has the map open in a browser
  await expect(page.locator(card('werk'))).toBeVisible()
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  // And the map does not show a card titled "Use an append-only log"
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  // When the person adds a card titled "Use an append-only log" under the root card from the command line
  werk.cli(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'werk'])
  // And the person accepts that card from the command line
  werk.cli(['accept', 'aol', '--actor', 'you'])
  // Then the map shows the card under the root card within a few seconds
  const drawn = page.locator(`${card('werk')} > ul > ${card('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  // But the person did not reload the page or click anything in the browser
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  // Given the server runs on a project, and the person has the map open in a browser
  // When the person opens a child card from the map
  await tile(page, 'map').click()
  // Then the address bar shows the id of that card
  await expect(page).toHaveURL(/#map$/)
  // And the page shows the detail of that card
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  // And the page has no text box or button that changes the title or the body of the card
  const views = page.locator('.views-pane')
  await expect(views.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(views.getByRole('button')).toHaveCount(0)
  // When the person reloads the page
  await page.reload()
  // Then the page opens the same card again, with the same id in the address bar
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
  await expect(page).toHaveURL(/#map$/)
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  test.setTimeout(30_000)
  // Given a server runs on a project
  await expect(page.locator(card('werk'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').count()
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  // When the person starts a second server on the same project directory
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('WERK_')))
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => (out += c.toString()))
  const started = Date.now()
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 12_000)
    second.once('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const took = Date.now() - started
  // Then the second server prints that it waits for the process id of the first server
  expect(out).toContain(`waiting for pid ${lock.pid}`)
  // And within about 5 seconds the second server stops with an error
  expect(code).not.toBe(-999)
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8_000)
  // And the error names the process id of the first server
  const afterWait = out.split('\n').filter((l) => !l.includes('waiting for pid')).join('\n')
  expect(afterWait).toContain(String(lock.pid))
  // And the map in the browser still loads from the first server and shows the same cards as before
  await page.goto(werk.url)
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.locator('li[data-card-id]')).toHaveCount(before)
})

// ---------------------------------------------------------------- 70

function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'map'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  // Given the map shows a real card "Payments"
  payments(werk)
  // And an agent proposes a new card "Refunds" that refines "Payments"
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  // When the person opens the map
  await page.goto(werk.url)
  // Then "Refunds" shows under "Payments" in the refines tree
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  // And "Refunds" is drawn grey and dashed
  await expect(refunds).toHaveCSS('border-top-style', 'dashed')
  await expect(refunds).toHaveCSS('color', 'rgb(138, 138, 138)')
  // But "Payments" is drawn as a normal real card, not grey and not dashed
  const pay = tile(page, 'payments')
  await expect(pay).not.toHaveCSS('border-top-style', 'dashed')
  await expect(pay).not.toHaveCSS('color', 'rgb(138, 138, 138)')
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  // Given the map shows a ghost card "Refunds" under the real card "Payments"
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  const before = logLines(werk).length
  // When the person opens the card view of "Refunds"
  await tile(page, 'refunds').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  // And the person presses the ✓ button
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  // Then the log has one new accept event for "Refunds" with the person as the actor
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  // And the card view of "Refunds" no longer shows a ✓ button
  await expect(page.getByRole('button', { name: 'Accept #refunds' })).toHaveCount(0)
  // And the map redraws "Refunds" as a real card under "Payments"
  await page.goto(werk.url)
  const r = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(r).toHaveAttribute('data-proposed', 'false')
  await expect(r.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  // Given the map shows a real card "Payments", a ghost "Refunds" under it, and a ghost "Partial refunds" under "Refunds"
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(werk.url)
  // When the person opens the card view of "Partial refunds" and presses ✓
  await tile(page, 'partial').click()
  await page.getByRole('button', { name: 'Accept #partial' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  // Then the map redraws "Partial refunds" and "Refunds" as real cards
  const chain = page.locator(`${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial')}`)
  // And "Partial refunds" still shows under "Refunds", and "Refunds" still shows under "Payments"
  await expect(chain).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'false')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  // Given the map shows a real card "Payments", and two ghost cards "Refunds" and "Chargebacks" under it
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  // And "Refunds" has a proposed option and a proposed source
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'No refunds', '--why-not', 'Customers leave'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  // And the map shows no control that accepts "Refunds" and "Chargebacks" together
  await expect(page.locator(card('chargebacks'))).toBeVisible()
  await expect(page.locator('.views-pane').getByRole('button')).toHaveCount(0)
  // When the person presses ✓ on "Refunds"
  await tile(page, 'refunds').click()
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  // Then "Refunds" redraws as a real card, with its option and its source as real
  await page.goto(`${werk.url}#refunds-opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  // But "Chargebacks" still shows grey and dashed
  await expect(tile(page, 'chargebacks')).toHaveCSS('border-top-style', 'dashed')
  await expect(tile(page, 'chargebacks')).toHaveCSS('color', 'rgb(138, 138, 138)')
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  // Given the person has the map open in two browser windows, both show a ghost card "Refunds"
  await page.goto(werk.url)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  // When the person presses ✓ on "Refunds" in the first window
  await tile(page, 'refunds').click()
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  // Then the second window redraws "Refunds" as a real card without a manual edit
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(tile(second, 'refunds')).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})

// ---------------------------------------------------------------- 71

function refCards(werk: Werk) {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment', '--parent', 'map'])
  werk.cli(['add', 'align', '--title', 'Align the cards', '--parent', 'map'])
  werk.cli(['accept', 'al-diff', '--actor', 'you'])
  werk.cli(['accept', 'align', '--actor', 'you'])
}

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  // Given the map holds a card "al-diff" and a card "align"
  refCards(werk)
  // And a card "notes-card" has a body that mentions ...
  const body = 'See #al-diff and #ghost-card, then al-diff and align.\n\nRun `node src/cli.ts show #al-diff` to print it.'
  werk.cli(['add', 'notes-card', '--title', 'Notes card', '--parent', 'map', '--body', body])
  // When the user opens the card "notes-card" in the map
  await page.goto(werk.url)
  await tile(page, 'notes-card').click()
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('See #al-diff')
  // Then the body shows "#al-diff" as a link
  await expect(b.locator('a', { hasText: '#al-diff' })).toHaveCount(1)
  await expect(b.locator('a', { hasText: '#al-diff' })).toHaveAttribute('href', '#al-diff')
  // And the body shows the bare "al-diff" as a link
  await expect(b.locator('a').filter({ hasText: /^al-diff$/ })).toHaveCount(1)
  // But the body shows "#ghost-card" as plain text
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  // And the body shows the bare word "align" as plain text
  await expect(b.locator('a', { hasText: 'align' })).toHaveCount(0)
  // And the body shows the code span as code with no link in it
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a')).toHaveCount(2)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  // Given the map holds a card "al-diff" with the summary "Diff the alignment"
  refCards(werk)
  // And a card "pr-iface" has a why line that mentions "#al-diff"
  werk.cli(['add', 'pr-iface', '--title', 'PR interface', '--parent', 'map', '--why', 'It builds on #al-diff.'])
  // When the user opens the card "pr-iface" in the map
  await page.goto(werk.url)
  await tile(page, 'pr-iface').click()
  // And the user clicks the "#al-diff" link in the why line
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  // Then the map shows the card "al-diff"
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  // And the user sees the summary "Diff the alignment"
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  // Given the map holds a card "al-diff"
  refCards(werk)
  // And a card "doc-card" has a body with a heading, a URL, a code span and a fenced block
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'Span: `#al-diff`', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc card', '--parent', 'map', '--body', body])
  // When the user opens the card "doc-card" in the map
  await page.goto(werk.url)
  await tile(page, 'doc-card').click()
  const b = page.getByTestId('card').locator('.body')
  // Then the heading shows the text "al-diff" with no link
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveCount(1)
  await expect(heading.locator('a')).toHaveCount(0)
  // And the URL fragment "#al-diff" is not a card link
  await expect(b).toContainText('https://example.com/page#al-diff')
  await expect(b.locator('a[href="#al-diff"]', { hasText: 'example.com' })).toHaveCount(0)
  // And the fenced block shows "#al-diff" as code with no link
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  // But the code span "#al-diff" shows as a link to the card "al-diff"
  const cardLinks = b.locator('a[href="#al-diff"]')
  await expect(cardLinks).toHaveCount(1)
  await expect(cardLinks).toHaveText('#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  // Given the map holds a card "al-diff"
  refCards(werk)
  // And a card "ref-card" has the summary "Follows up on #al-diff"
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff', '--parent', 'map'])
  // And the card "ref-card" has a note that says "See al-diff first"
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  // When the user looks at the grid
  await page.goto(werk.url)
  const t = tile(page, 'ref-card')
  // Then the tile for "ref-card" shows the text "Follows up on #al-diff" with no link in it
  await expect(t).toContainText('Follows up on #al-diff')
  await expect(t.locator('a')).toHaveCount(0)
  // When the user clicks the tile for "ref-card"
  await t.click()
  // Then the map opens the card "ref-card"
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  // And the notes thread shows "al-diff" as a link
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  // Given a card "code-card" has a body with a fenced "json" block with a nested object, four-space indentation, and one long line
  const long = `        "deep": "${'y'.repeat(400)}"`
  const body = ['Some text before.', '', '```json', '{', '    "a": {', long, '    }', '}', '```'].join('\n')
  werk.cli(['add', 'code-card', '--title', 'Code card', '--parent', 'map', '--body', body])
  // When the user opens the card "code-card" in the map
  await page.goto(werk.url)
  await tile(page, 'code-card').click()
  const pre = page.getByTestId('card').locator('pre')
  // Then the code shows inside a box with syntax highlighting
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class]').count()).toBeGreaterThan(0)
  // And every line keeps the indentation the writer gave it
  const text = (await pre.textContent()) ?? ''
  expect(text).toContain('\n    "a": {')
  expect(text).toContain(`\n${long}`)
  expect(text).toContain('\n    }')
  // And the user can scroll the box sideways to read the end of the long line
  const widths = await pre.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(widths.scroll).toBeGreaterThan(widths.client)
  await pre.hover()
  await page.mouse.wheel(5000, 0)
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  // And the rest of the card body does not grow wider than the card
  const sizes = await page.getByTestId('card').evaluate((c) => {
    const b = c.querySelector('.body') as HTMLElement
    return { card: c.clientWidth, body: b.scrollWidth, cardScroll: c.scrollWidth }
  })
  expect(sizes.body).toBeLessThanOrEqual(sizes.card)
  expect(sizes.cardScroll).toBeLessThanOrEqual(sizes.card)
})

// ---------------------------------------------------------------- 72

const statusColour = (page: Page, id: string) => tile(page, id).evaluate((a) => getComputedStyle(a).borderLeftColor)

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  // Given a map with card A, card B that depends on A, and card C that depends on B; all three decided
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  decided(werk, 'cc', ['cb'])
  // When the person reopens card A from the command line with the reason rejected and a sentence
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  // And the person opens the map in the browser
  await page.goto(werk.url)
  const decidedColour = await statusColour(page, 'log')
  // Then card B shows a red stale mark
  const bMark = tile(page, 'cb').locator('.mark')
  await expect(bMark).toHaveText('stale')
  await expect(bMark).toHaveCSS('background-color', RED)
  // And card B still shows the decided status colour under the mark
  await expect(tile(page, 'cb')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cb')).toHaveCSS('border-left-color', decidedColour)
  // But card C shows no stale mark / And card C shows no paused mark
  await expect(tile(page, 'cc')).toBeVisible()
  await expect(tile(page, 'cc').locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  // Given a map with card A, B depends on A, C depends on B; B and C decided
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  decided(werk, 'cc', ['cb'])
  // When the person reopens card A with the reason postponed
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'The engine waits'])
  // And the person opens the map in the browser
  await page.goto(werk.url)
  const decidedColour = await statusColour(page, 'log')
  // Then card B shows a grey paused mark
  await expect(tile(page, 'cb').locator('.mark')).toHaveText('paused')
  await expect(tile(page, 'cb').locator('.mark')).toHaveCSS('background-color', GREY)
  // And card C, two hops away from card A, shows a grey paused mark
  await expect(tile(page, 'cc').locator('.mark')).toHaveText('paused')
  await expect(tile(page, 'cc').locator('.mark')).toHaveCSS('background-color', GREY)
  // And card C still shows the decided status colour under the grey mark
  await expect(tile(page, 'cc')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'cc')).toHaveCSS('border-left-color', decidedColour)
  // And neither card B nor card C shows a red stale mark
  await expect(tile(page, 'cb').locator('.mark[data-mark="stale"]')).toHaveCount(0)
  await expect(tile(page, 'cc').locator('.mark[data-mark="stale"]')).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  // Given a map with card A and card B that depends on A
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  // And the person reopens card A with the reason rejected and the sentence "The vendor dropped this API"
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  // When the person opens the map in the browser / And the person opens card B
  await page.goto(werk.url)
  await tile(page, 'cb').click()
  // Then the card view shows the heading "Why this card is stale"
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  // And under that heading the person sees that card A was reopened
  const trace = marks.locator('li').first()
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('was reopened')
  // And the person sees that card B depends on card A
  await expect(trace).toContainText('depends_on')
  // And the person sees the reason rejected and the sentence
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  // Given a map with card A, card B that depends on A, and card C that depends on B
  decided(werk, 'ca')
  decided(werk, 'cb', ['ca'])
  decided(werk, 'cc', ['cb'])
  // And the person reopens card A with the reason postponed and the sentence "We build the engine next quarter"
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  // When the person opens the map in the browser / And the person opens card C
  await page.goto(werk.url)
  await tile(page, 'cc').click()
  // Then the card view shows the heading "Why this card is stale"
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  // And the person sees that card A was reopened
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('was reopened')
  // And the person sees the reason postponed and the sentence
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  // Given a map with card A, card X, and card B that depends on both card A and card X
  decided(werk, 'ca')
  decided(werk, 'cx')
  decided(werk, 'cb', ['ca', 'cx'])
  // And the person reopens card X with the reason postponed / card A with the reason rejected
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'Wrong'])
  // When the person opens the map in the browser
  await page.goto(werk.url)
  // Then card B shows a red stale mark
  const mark = tile(page, 'cb').locator('.mark')
  await expect(mark).toHaveText('stale')
  await expect(mark).toHaveCSS('background-color', RED)
  // But card B does not show a grey paused mark
  await expect(tile(page, 'cb').locator('.mark[data-mark="paused"]')).toHaveCount(0)
  // And when the person opens card B, the card view names card A and the reason rejected
  await tile(page, 'cb').click()
  const marks = page.getByRole('region', { name: 'marks' })
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('rejected')
})
