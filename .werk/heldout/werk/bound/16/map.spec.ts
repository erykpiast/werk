// Held-out steps 02.x, 03.x, 04.x, 07.x. Each test boots its own `werk serve` on a scratch
// project. Ports 5000-5099.
import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLI, cli, events, project, serve, writeCards, type Server } from './helpers.ts'

let port = 5000
let srv: Server | null = null

test.beforeEach(async ({ page }) => {
  await page.route('**/api/chat', (r) => r.abort())
  await page.route('https://esm.sh/**', (r) => r.abort())
  await page.addInitScript(() => localStorage.clear())
})
test.afterEach(async () => {
  await srv?.stop()
  srv = null
})

const KILL = { form: 'manual', text: 'I test this myself', trigger: 'manual', state: 'monitored' }
const killEv = (id: string) => ({ type: 'kill.added', payload: { id, criterion: KILL } })
const hero = (page: Page) => page.locator('#hero .hero')
const card = (page: Page, id: string) => page.locator(`#sections button.card[data-go="${id}"]`)

/** Run one command line the CLI printed, with `node src/cli.ts` as the CLI. */
function runPrinted(p: ReturnType<typeof project>, line: string) {
  const cmd = plain(line).trim().replace(/^node src\/cli\.ts/, `bun ${JSON.stringify(CLI)}`)
  const r = spawnSync('sh', ['-c', cmd], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, WERK_LOG: p.log, PATH: `${p.bin}:${process.env.PATH}` },
  })
  return { code: r.status, out: r.stdout + r.stderr }
}

/** A terminal shows colour codes as colour, not text: strip them before a line is copied. */
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

// ---------------------------------------------------------------- 02

test('02.1 a retitle appends one event and the map shows only the new title', async () => {
  const p = project()
  expect(cli(p, ['add', 'a', '--title', 'Use a log']).code).toBe(0)
  expect(cli(p, ['add', 'b', '--title', 'Cards fold from it']).code).toBe(0)
  expect(cli(p, ['link', 'b', 'a', '--type', 'refines']).code).toBe(0)
  const saved = join(p.dir, 'saved.jsonl')
  copyFileSync(p.log, saved)
  const before = readFileSync(saved, 'utf8')
  const r = cli(p, ['retitle', 'a', 'Use an append-only log'])
  const after = readFileSync(p.log, 'utf8')
  expect(after.split('\n').filter(Boolean).length, `retitle output: ${r.out}`).toBe(before.split('\n').filter(Boolean).length + 1)
  expect(after.startsWith(before)).toBe(true)
  const map = cli(p, ['show', 'b']).stdout
  expect(map).toContain('Use an append-only log')
  const show = cli(p, ['show', 'a']).stdout
  expect(show).toContain('Use an append-only log')
  expect(show.split('\n')[1]).not.toBe('Use a log')
  expect(map).not.toMatch(/a\s+Use a log$/m)
  expect(after).toContain('"Use a log"')
})

test('02.2 a card added from the command line appears in an open page without a reload', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'a', title: 'Use an append-only log' }])
  srv = await serve(p, ++port)
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(`${srv.url}/map/a`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  expect(cli(p, ['add', 'c', '--title', 'Fold is pure']).code).toBe(0)
  expect(cli(p, ['link', 'c', 'a', '--type', 'refines']).code).toBe(0)
  await expect(card(page, 'c')).toContainText('Fold is pure')
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  expect(loads).toBe(1)
})

test('02.3 a status change from the command line shows in the browser and in the command line', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'a', title: 'Use an append-only log', who: 'me', noBasis: true }], [killEv('a')])
  srv = await serve(p, ++port)
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(`${srv.url}/map/a`)
  await expect(hero(page).locator('.tag.open')).toBeVisible()
  const before = events(p.log).length
  const r = cli(p, ['status', 'a', 'decided'])
  expect(r.code, r.out).toBe(0)
  await expect(hero(page)).toHaveClass(/\bdecided\b/)
  await expect(hero(page).locator('.tag.decided')).toHaveText('decided')
  expect(loads).toBe(1)
  expect(cli(p, ['show', 'a']).stdout).toContain('[decided]')
  const ev = events(p.log)
  expect(ev.length).toBe(before + 1)
  expect(ev.at(-1)).toMatchObject({ type: 'status.set', payload: { id: 'a', status: 'decided' } })
  expect(ev.at(-1).seq).toBeGreaterThan(ev.at(-2).seq)
})

test('02.4 a card id in the location hash opens that card', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'a', title: 'Use an append-only log' }, { id: 'b', title: 'Cards fold from it', parent: 'a' }])
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/#b`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await page.reload()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
})

test('02.5 a page control changes a card only by appending an event', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'a', title: 'Use an append-only log' }, { id: 'b', title: 'Cards fold from it', parent: 'a' }])
  const before = readFileSync(p.log, 'utf8')
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/b`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  // The page controls that change a real card: ✕ (remove). Accept needs a proposal.
  page.once('dialog', (d) => d.accept())
  await hero(page).locator('[data-remove="b"]').click()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  await expect(card(page, 'b')).toHaveCount(0)
  const after = readFileSync(p.log, 'utf8')
  expect(after.split('\n').filter(Boolean).length).toBe(before.split('\n').filter(Boolean).length + 1)
  expect(after.startsWith(before)).toBe(true)
  // The page shows b gone from the map; `show b` must print the same state.
  const show = cli(p, ['show', 'b'])
  expect(show.out).toMatch(/no node with the id "b"/)
})

// ---------------------------------------------------------------- 03

test('03.1 a missing kill criterion blocks decided, and the printed command fixes it', async ({ page }) => {
  const p = project()
  writeCards(
    p.log,
    [
      { id: 'base', title: 'Base', status: 'decided', who: 'me', noBasis: true },
      { id: 'k', title: 'Pick a store', who: 'you', dependsOn: ['base'] },
      { id: 'k:opt0', kind: 'option', title: 'Use files', extra: { why_not: 'no queries' } },
    ],
    [killEv('base'), { type: 'edge.added', payload: { from: 'k:opt0', to: 'k', type: 'alternative_to' } }],
  )
  const before = readFileSync(p.log, 'utf8')
  const r = cli(p, ['status', 'k', 'decided'])
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/kill criterion/)
  const line = plain(r.out).split('\n').find((l) => /node src\/cli\.ts kill k --form manual/.test(l))
  expect(line, r.out).toBeTruthy()
  expect(cli(p, ['show', 'k']).stdout).toContain('[open]')
  expect(readFileSync(p.log, 'utf8')).toBe(before)
  const filled = line!.replace('I test this myself and see if it works', 'Ten users find a card in under a minute')
  const fix = runPrinted(p, filled)
  expect(fix.code, fix.out).toBe(0)
  const again = cli(p, ['status', 'k', 'decided'])
  expect(again.code, again.out).toBe(0)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/k`)
  await expect(hero(page).locator('.tag.decided')).toHaveText('decided')
})

test('03.2 each missing fact prints its own fixing command', async ({ page }) => {
  const p = project()
  writeCards(
    p.log,
    [
      { id: 'base', title: 'Base', status: 'decided', who: 'me', noBasis: true },
      { id: 'c1', title: 'No decider', dependsOn: ['base'] },
      { id: 'c2', title: 'No basis', who: 'me' },
      { id: 'c3', title: 'No options', who: 'you', dependsOn: ['base'] },
      { id: 'c4', title: 'No kill', who: 'me', dependsOn: ['base'] },
    ],
    [killEv('base'), killEv('c1'), killEv('c2'), killEv('c3')],
  )
  const fixes: Record<string, string> = {}
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const before = events(p.log).length
    const r = cli(p, ['status', id, 'decided'])
    expect(r.code, `${id}: ${r.out}`).not.toBe(0)
    expect(events(p.log).length).toBe(before)
    const cmds = plain(r.out).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('node src/cli.ts'))
    expect(cmds.length, r.out).toBeGreaterThan(0)
    fixes[id] = cmds.join('\n')
  }
  expect(fixes.c1).toMatch(/edit c1 --who/)
  expect(fixes.c2).toMatch(/link c2 .* --type depends_on|edit c2 --no-basis/)
  expect(fixes.c3).toMatch(/edit c3 --unchallenged|--kind option/)
  expect(fixes.c4).toMatch(/kill c4 --form/)
  expect(new Set(Object.values(fixes)).size).toBe(4)
  const pick = (id: string, re: RegExp) => fixes[id].split('\n').find((l) => re.test(l))!
  const runs = [
    pick('c1', /edit c1 --who/).replace('you|me|prototype', 'me'),
    pick('c2', /edit c2 --no-basis/),
    pick('c3', /edit c3 --unchallenged/),
    pick('c4', /kill c4 --form revisit/),
  ]
  for (const l of runs) {
    const r = runPrinted(p, l)
    expect(r.code, `${JSON.stringify(l)}: ${r.out}`).toBe(0)
  }
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const r = cli(p, ['status', id, 'decided'])
    expect(r.code, `${id}: ${r.out}`).toBe(0)
  }
  srv = await serve(p, ++port)
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    await page.goto(`${srv.url}/map/${id}`)
    await expect(hero(page).locator('.tag.decided')).toHaveText('decided')
  }
})

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'u', title: 'Ship on Fridays', who: 'you' }], [killEv('u')])
  // There is no flag for a reason with --no-basis; the help lists only the bare flag.
  const nb = cli(p, ['edit', 'u', '--no-basis'])
  expect(nb.code, nb.out).toBe(0)
  const un = cli(p, ['edit', 'u', '--unchallenged'])
  expect(un.code, un.out).toBe(0)
  const r = cli(p, ['status', 'u', 'decided'])
  expect(r.code, r.out).toBe(0)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/u`)
  await expect(hero(page).locator('.tag.decided')).toHaveText('decided')
  await expect(hero(page).locator('.tag.unchallenged')).toBeVisible()
  // The stated lack of basis, with its reason, must be visible on the card.
  await expect(page.locator('#map-view')).toContainText(/no basis|needs no depends_on|no depends_on/i, { timeout: 3000 })
})

test('03.4 an amend of a decided card cannot remove a required fact', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'd', title: 'Decided card', body: 'old body', status: 'decided', who: 'me', noBasis: true }], [killEv('d')])
  const before = events(p.log).length
  const r = cli(p, ['kill', 'd', '--clear'])
  const ev = events(p.log)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/d`)
  // Recorded before the asserts, so the second half runs and is reported too.
  const second = cli(p, ['edit', 'd', '--body', 'new body text'])
  await expect(page.locator('#hero .body')).toContainText('new body text')
  expect(second.code, second.out).toBe(0)
  expect(r.code, `kill --clear output: ${r.out}`).not.toBe(0)
  expect(r.out).toMatch(/kill d --form/)
  expect(ev.length).toBe(before)
  await expect(page.locator('#sections')).toContainText('Manual test')
  await expect(hero(page).locator('.tag.decided')).toHaveText('decided')
})

test('03.5 adding a card and setting it open are not checked', async ({ page }) => {
  const p = project()
  const add = cli(p, ['add', 'x', '--title', 'Just a title', '--body', 'Just a body'])
  expect(add.code, add.out).toBe(0)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/x`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Just a title')
  const open = cli(p, ['status', 'x', 'open'])
  expect(open.code, open.out).toBe(0)
  await expect(hero(page).locator('.tag.open')).toHaveText('open')
  const dec = cli(p, ['status', 'x', 'decided'])
  expect(dec.code).not.toBe(0)
  expect(cli(p, ['show', 'x']).stdout).toContain('[open]')
  await expect(hero(page).locator('.tag.open')).toHaveText('open')
})

// ---------------------------------------------------------------- 04

/** A map with a rollup, a stale mark and an unchallenged card around "Checkout flow". */
function checkoutMap(log: string) {
  writeCards(
    log,
    [
      { id: 'root', title: 'Shop', status: 'decided', who: 'me', noBasis: true },
      { id: 'checkout', title: 'Checkout flow', status: 'decided', who: 'you', noBasis: true, parent: 'root', extra: { noAlternative: true } },
      { id: 'pricing', title: 'Pricing', status: 'decided', who: 'me', noBasis: true, parent: 'root' },
      { id: 'tax', title: 'Tax', status: 'decided', who: 'me', parent: 'checkout', dependsOn: ['pricing'] },
    ],
    [killEv('root'), killEv('checkout'), killEv('pricing'), killEv('tax'), { type: 'reopened', payload: { id: 'pricing', reason: 'rejected' }, actor: 'you' }],
  )
}

async function marks(page: Page, url: string) {
  const g = await (await page.request.get(`${url}/api/graph`)).json()
  return { rollup: g.rollup, stale: g.stale, unchallenged: g.unchallenged, postponed: g.postponed }
}

test('04.1 an agent card waits as a ghost until the ✓', async ({ page }) => {
  const p = project()
  checkoutMap(p.log)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/checkout`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Checkout flow')
  const counts = (await page.locator('#counts').textContent()) ?? ''
  const heroRollup = (await hero(page).locator('.rollup-line').textContent()) ?? ''
  const m0 = await marks(page, srv.url)
  const n0 = events(p.log).length
  const add = cli(p, ['add', 'retry', '--title', 'Retry payment', '--parent', 'checkout'])
  expect(add.code, add.out).toBe(0)
  expect(add.stdout).toMatch(/\bproposed\b/)
  expect(add.stdout).not.toMatch(/\badded\b/)
  const newEv = events(p.log).slice(n0)
  expect(newEv.some((e) => e.type === 'node.proposed' && e.payload.id === 'retry')).toBe(true)
  expect(newEv.some((e) => e.type === 'node.added')).toBe(false)
  const ghost = card(page, 'retry')
  await expect(ghost).toContainText('Retry payment')
  await expect(ghost).toHaveClass(/is-ghost/)
  await expect(page.locator('#counts')).toHaveText(counts)
  await expect(hero(page).locator('.rollup-line')).toHaveText(heroRollup)
  expect(await marks(page, srv.url)).toEqual(m0)
  const style = await ghost.evaluate((e) => {
    const s = getComputedStyle(e)
    return { border: s.borderTopStyle, color: s.borderTopColor, bg: s.backgroundColor }
  })
  // A second ghost elsewhere, to prove the ✓ accepts only "Retry payment".
  expect(cli(p, ['add', 'other', '--title', 'Other ghost', '--parent', 'root']).code).toBe(0)
  const n1 = events(p.log).length
  // Grey and dashed; not the blue of a pending edit (#3b82f6 = rgb(59, 130, 246)).
  const blue = /59,\s*130,\s*246/
  const styleOk = style.border === 'dashed' && !blue.test(style.color) && !blue.test(style.bg)
  await ghost.click()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Retry payment')
  await hero(page).locator('[data-accept-change="retry"]').click()
  await expect(hero(page).locator('.tag.ghost')).toHaveCount(0)
  const accepted = events(p.log).slice(n1)
  expect(accepted.length).toBe(1)
  expect(accepted[0]).toMatchObject({ type: 'change.accepted', payload: { id: 'retry' } })
  await page.goto(`${srv.url}/map/checkout`)
  await expect(card(page, 'retry')).not.toHaveClass(/is-ghost/)
  const g = await (await page.request.get(`${srv.url}/api/graph`)).json()
  expect(g.proposed).toEqual(['other'])
  expect(styleOk, `ghost card style ${JSON.stringify(style)}`).toBe(true)
})

test('04.2 accepting a ghost child accepts its ghost parent; the held edge goes live', async ({ page }) => {
  const p = project()
  writeCards(
    p.log,
    [
      { id: 'root', title: 'Shop', status: 'decided', who: 'me', noBasis: true },
      { id: 'payments', title: 'Payments', status: 'decided', who: 'me', noBasis: true, parent: 'root' },
      { id: 'fraud', title: 'Fraud rules', status: 'decided', who: 'me', noBasis: true, parent: 'root' },
    ],
    [killEv('root'), killEv('payments'), killEv('fraud')],
  )
  for (const args of [
    ['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'],
    ['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'],
    ['link', 'partial', 'fraud', '--type', 'depends_on', '--why', 'a partial refund runs the fraud rules'],
    ['add', 'partial:opt0', '--kind', 'option', '--title', 'Full refunds only', '--why_not', 'customers ask for partial'],
    ['link', 'partial:opt0', 'partial', '--type', 'alternative_to'],
    ['add', 'partial:src0', '--kind', 'source', '--title', 'Support tickets', '--url', 'https://example.com/t'],
    ['link', 'partial', 'partial:src0', '--type', 'supported_by'],
  ]) {
    const r = cli(p, args)
    expect(r.code, `${args.join(' ')}: ${r.out}`).toBe(0)
  }
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/partial`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Partial refunds')
  await expect(page.locator('#sections')).toContainText('Fraud rules')
  let g = await (await page.request.get(`${srv.url}/api/graph`)).json()
  const isDep = (e: any) => e.from === 'partial' && e.to === 'fraud' && e.type === 'depends_on'
  expect(g.ghostEdges.some(isDep)).toBe(true)
  expect(g.edges.some(isDep)).toBe(false)
  const n0 = events(p.log).length
  await hero(page).locator('[data-accept-change="partial"]').click()
  await expect(hero(page).locator('.tag.ghost')).toHaveCount(0)
  const newEv = events(p.log).slice(n0)
  expect(newEv.every((e) => e.type === 'change.accepted')).toBe(true)
  expect(newEv.some((e) => e.type.startsWith('edge.'))).toBe(false)
  g = await (await page.request.get(`${srv.url}/api/graph`)).json()
  expect(g.proposed).toEqual([])
  expect(g.edges.some(isDep)).toBe(true)
  // "one accept event": the closure writes one change.accepted per accepted node.
  expect(newEv.length, `accept events: ${JSON.stringify(newEv.map((e) => e.payload.id))}`).toBe(1)
})

test('04.3 discarding a ghost parent drops its ghost children', async ({ page }) => {
  const p = project()
  writeCards(
    p.log,
    [
      { id: 'root', title: 'App', status: 'decided', who: 'me', noBasis: true },
      { id: 'onb', title: 'Onboarding', status: 'decided', who: 'you', noBasis: true, parent: 'root', extra: { noAlternative: true } },
    ],
    [killEv('root'), killEv('onb')],
  )
  srv = await serve(p, ++port)
  const m0 = await marks(page, srv.url)
  expect(cli(p, ['add', 'email', '--title', 'Email verification', '--parent', 'onb']).code).toBe(0)
  expect(cli(p, ['add', 'resend', '--title', 'Resend email', '--parent', 'email']).code).toBe(0)
  await page.goto(`${srv.url}/map/email`)
  page.once('dialog', (d) => d.accept())
  await hero(page).locator('[data-remove="email"]').click()
  await page.goto(`${srv.url}/map/onb`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Onboarding')
  await expect(page.locator('body')).not.toContainText('Email verification')
  await expect(page.locator('body')).not.toContainText('Resend email')
  await expect(page.locator('#sections .card.is-ghost')).toHaveCount(0)
  expect(await marks(page, srv.url)).toEqual(m0)
})

test('04.4 a ghost is frozen in words but can be proposed as decided', async ({ page }) => {
  const p = project()
  writeCards(
    p.log,
    [
      { id: 'root', title: 'App', status: 'decided', who: 'me', noBasis: true },
      { id: 'search', title: 'Search', status: 'decided', who: 'me', noBasis: true, parent: 'root' },
      { id: 'store', title: 'Document store', status: 'decided', who: 'me', noBasis: true, parent: 'root' },
    ],
    [killEv('root'), killEv('search'), killEv('store')],
  )
  expect(cli(p, ['add', 'sidx', '--title', 'Search index', '--body', 'first body', '--why', 'first why', '--parent', 'search']).code).toBe(0)
  const again = cli(p, ['add', 'sidx', '--title', 'Search index v2', '--body', 'second body'])
  expect(again.code).not.toBe(0)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/sidx`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Search index')
  await expect(page.locator('#hero .body')).toHaveText('first body')
  for (const args of [
    ['edit', 'sidx', '--body', 'changed body'],
    ['edit', 'sidx', '--why', 'changed why'],
    ['retitle', 'sidx', 'Changed title'],
  ]) {
    expect(cli(p, args).code, args.join(' ')).not.toBe(0)
  }
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Search index')
  await expect(page.locator('#hero .body')).toHaveText('first body')
  await expect(hero(page).locator('.why')).toHaveText('first why')
  const who = cli(p, ['edit', 'sidx', '--who', 'you'])
  expect(who.code, who.out).toBe(0)
  const d1 = cli(p, ['status', 'sidx', 'decided'])
  expect(d1.code).not.toBe(0)
  expect(d1.out).toMatch(/no depends_on edge/)
  expect(d1.out).toMatch(/node src\/cli\.ts link sidx/)
  expect(cli(p, ['show', 'sidx']).stdout).toMatch(/\[open\].*PROPOSED/)
  for (const args of [
    ['link', 'sidx', 'store', '--type', 'depends_on', '--why', 'the index reads the store'],
    ['add', 'sidx:opt0', '--kind', 'option', '--title', 'Scan on every query', '--why_not', 'too slow past 10k docs'],
    ['link', 'sidx:opt0', 'sidx', '--type', 'alternative_to'],
    ['kill', 'sidx', '--form', 'manual', '--text', 'a query over 100k docs takes under 200 ms'],
  ]) {
    const r = cli(p, args)
    expect(r.code, `${args.join(' ')}: ${r.out}`).toBe(0)
  }
  const d2 = cli(p, ['status', 'sidx', 'decided'])
  expect(d2.code, d2.out).toBe(0)
  await expect(hero(page)).toHaveClass(/is-ghost/)
  await expect(hero(page).locator('.tag.decided')).toHaveText('decided')
  await hero(page).locator('[data-accept-change="sidx"]').click()
  await expect(hero(page).locator('.tag.ghost')).toHaveCount(0)
  const g = await (await page.request.get(`${srv.url}/api/graph`)).json()
  expect(g.proposed).toEqual([])
  expect(g.nodes.find((n: any) => n.id === 'sidx').status).toBe('decided')
  expect(g.edges.some((e: any) => e.from === 'sidx' && e.to === 'store' && e.type === 'depends_on')).toBe(true)
  expect(g.edges.some((e: any) => e.from === 'sidx:opt0' && e.to === 'sidx' && e.type === 'alternative_to')).toBe(true)
})

test('04.5 a command-line accept needs the statement that the person asked for it', async ({ page }) => {
  const p = project()
  writeCards(p.log, [{ id: 'root', title: 'App', status: 'decided', who: 'me', noBasis: true }], [killEv('root')])
  expect(cli(p, ['add', 'audit', '--title', 'Audit log', '--parent', 'root']).code).toBe(0)
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map`)
  await expect(card(page, 'audit')).toHaveClass(/is-ghost/)
  const before = readFileSync(p.log, 'utf8')
  const r = cli(p, ['accept', 'audit'])
  expect(r.code).not.toBe(0)
  expect(readFileSync(p.log, 'utf8')).toBe(before)
  await expect(card(page, 'audit')).toHaveClass(/is-ghost/)
  const ok = cli(p, ['accept', 'audit', '--actor', 'you'])
  expect(ok.code, ok.out).toBe(0)
  await expect(card(page, 'audit')).not.toHaveClass(/is-ghost/)
  await expect(card(page, 'audit')).toContainText('Audit log')
})

// ---------------------------------------------------------------- 07

test('07.1 a known card reference in a card body opens that card', async ({ page }) => {
  const p = project()
  writeCards(p.log, [
    { id: 'al-diff', title: 'Diff card' },
    { id: 'notes-card', title: 'Notes', body: 'see #al-diff and #ghost-card for details' },
  ])
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/notes-card`)
  const body = page.locator('#hero .body')
  await expect(body.getByRole('link', { name: '#al-diff' })).toBeVisible()
  await expect(body).toContainText('#ghost-card')
  await expect(body.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await body.getByRole('link', { name: '#al-diff' }).click()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Diff card')
})

test('07.2 bare ids and code spans link only when they have the shape of an id', async ({ page }) => {
  const p = project()
  writeCards(
    p.log,
    [
      { id: 'align', title: 'Align' },
      { id: 'al-diff', title: 'Diff card' },
      { id: 'pr-iface:opt0', kind: 'option', title: 'Option zero' },
      { id: 'host', title: 'Host card', why: 'compare al-diff with pr-iface:opt0, then align the rest' },
    ],
    [{ type: 'note.added', payload: { node: 'host', text: 'see `al-diff` and `node src/cli.ts show #al-diff` and `**bold** and _italic_`' }, actor: 'you' }],
  )
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/host`)
  const why = hero(page).locator('.why')
  await expect(why.locator('a.ref[href="/map/al-diff"]')).toBeVisible()
  await expect(why.locator('a.ref[href="/map/pr-iface:opt0"]')).toBeVisible()
  await expect(why).toContainText('align the rest')
  await expect(why.locator('a', { hasText: /^#?align$/ })).toHaveCount(0)
  const note = page.locator('.thread .note .t')
  await expect(note.locator('a.ref[href="/map/al-diff"]')).toHaveCount(1)
  await expect(note.locator('code', { hasText: 'node src/cli.ts show #al-diff' })).toHaveCount(1)
  await expect(note.locator('code', { hasText: 'node src/cli.ts show #al-diff' }).locator('a')).toHaveCount(0)
  const lit = note.locator('code', { hasText: '**bold** and _italic_' })
  await expect(lit).toHaveCount(1)
  await expect(note.locator('strong, em')).toHaveCount(0)
})

test('07.3 the link rule leaves fenced blocks, headings and URL fragments alone', async ({ page }) => {
  const p = project()
  const body = ['# al-diff', '', '```', 'echo #al-diff', '```', '', 'Read [the page](https://example.com/page#al-diff).'].join('\n')
  writeCards(p.log, [
    { id: 'al-diff', title: 'Diff card' },
    { id: 'host', title: 'Host card', body },
  ])
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/host`)
  const b = page.locator('#hero .body')
  await expect(b.locator('pre code')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  await expect(b.locator('a[href="https://example.com/page#al-diff"]')).toHaveCount(1)
  await expect(b.getByRole('heading', { level: 1 })).toHaveText(/al-diff/)
  await expect(b.getByRole('heading', { level: 1 }).locator('a')).toHaveCount(0)
})

test('07.4 a grid tile summary shows a reference without a link', async ({ page }) => {
  const p = project()
  writeCards(p.log, [
    { id: 'root', title: 'Top' },
    { id: 'al-diff', title: 'Diff card', parent: 'root' },
    { id: 'second', title: 'Second card', why: 'depends on #al-diff', parent: 'root' },
  ])
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map`)
  const tile = card(page, 'second')
  await expect(tile).toContainText('depends on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Second card')
})

test('07.5 fenced code is boxed, highlighted and scrolls sideways without reformatting', async ({ page }) => {
  const p = project()
  const wide = `  "long": "${'x'.repeat(400)}",`
  const body = [
    'Code:',
    '',
    '```json',
    '{',
    '      "a": 1,',
    '"b":    [true,',
    '   null],',
    wide,
    '  "c": "d"',
    '}',
    '```',
    '',
    '```js',
    'const a = 1 // one',
    '```',
    '',
    '```ts',
    'let b: number = 2',
    '```',
    '',
    '```bash',
    'echo "hi" --flag',
    '```',
  ].join('\n')
  writeCards(p.log, [{ id: 'host', title: 'Code card', body }])
  srv = await serve(p, ++port)
  await page.goto(`${srv.url}/map/host`)
  const pres = page.locator('#hero .body pre')
  await expect(pres).toHaveCount(4)
  for (let i = 0; i < 4; i++) {
    const box = await pres.nth(i).evaluate((e) => {
      const s = getComputedStyle(e)
      return { border: s.borderTopStyle, width: s.borderTopWidth, bg: s.backgroundColor }
    })
    expect(box.border !== 'none' && box.width !== '0px', `pre ${i} ${JSON.stringify(box)}`).toBe(true)
    const colored = await pres.nth(i).locator('span[class^="tok-"]').evaluateAll((spans) => {
      const base = spans[0] ? getComputedStyle(spans[0].closest('pre')!).color : ''
      return spans.some((s) => getComputedStyle(s).color !== base)
    })
    expect(colored, `pre ${i} has syntax colours`).toBe(true)
  }
  const jsonText = await pres.nth(0).locator('code').innerText()
  expect(jsonText).toContain('\n      "a": 1,\n"b":    [true,\n   null],\n')
  const scroll = await pres.nth(0).evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX }))
  expect(scroll.sw).toBeGreaterThan(scroll.cw)
  expect(['auto', 'scroll']).toContain(scroll.ox)
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(doc.sw).toBeLessThanOrEqual(doc.cw)
})
