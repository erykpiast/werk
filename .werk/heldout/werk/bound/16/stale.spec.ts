// Held-out steps 05.1 .. 05.5: reopen reasons, stale and postponed marks, review.
import { expect, test, type Page } from '@playwright/test'
import { cli, project, serve, writeCards, type Card, type Server } from './helpers.ts'

const RED = 'rgb(248, 81, 73)'
const DECIDED = 'rgb(63, 185, 80)'
const OPEN = 'rgb(210, 153, 34)'

let server: Server | null = null

test.beforeEach(async ({ page }) => {
  await page.route('**/api/chat', (route) => route.abort())
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.addInitScript(() => localStorage.clear())
})

test.afterEach(async () => {
  await server?.stop()
  server = null
})

function setup(cards: Card[]) {
  const p = project()
  writeCards(p.log, [{ id: 'root', title: 'Root', status: 'open' }, ...cards.map((c) => ({ parent: 'root', ...c }))])
  return p
}

const card = (page: Page, id: string) => page.locator(`#sections button.card[data-go="${id}"]`)
const leftColor = (page: Page, id: string) => card(page, id).evaluate((el) => getComputedStyle(el).borderLeftColor)
const bgImage = (page: Page, id: string) => card(page, id).evaluate((el) => getComputedStyle(el).backgroundImage)

/** The staleness listing's line for one card, or '' when the card is not listed. */
const lineOf = (listing: string, id: string) => listing.split('\n').find((l) => new RegExp(`\\s${id}\\s`).test(` ${l} `)) ?? ''

test('05.1 a reopen without a reason is refused and leaves the map unchanged', async ({ page }) => {
  const p = setup([
    { id: 'pricing', title: 'Pricing', status: 'decided' },
    { id: 'checkout', title: 'Checkout', status: 'decided', dependsOn: ['pricing'] },
  ])
  const r = cli(p, ['reopen', 'pricing', '--actor', 'you'])
  console.log('05.1 reopen:', r.code, r.out)
  expect.soft(r.code, 'reopen without a reason is refused').not.toBe(0)
  expect.soft(r.out, 'message names postponed and rejected as the required reasons').toMatch(/reason/i)
  expect.soft(r.out).toMatch(/postponed/)
  expect.soft(r.out).toMatch(/rejected/)

  const show = cli(p, ['show', 'pricing']).out
  expect.soft(show.split('\n')[0], 'pricing still decided (show)').toContain('[decided]')
  server = await serve(p, 5101)
  await page.goto(`${server.url}/`)
  await expect.soft(card(page, 'pricing'), 'pricing still decided (browser)').toHaveClass(/\bdecided\b/)

  const stale = cli(p, ['stale']).out
  console.log('05.1 stale:', stale)
  expect.soft(stale, 'the staleness listing shows no marked cards').toContain('Nothing is stale')
})

test('05.2 a rejected reopen marks only the next hop, and a review moves the mark one hop on', async ({ page }) => {
  const p = setup([
    { id: 'storage', title: 'Storage', status: 'decided' },
    { id: 'api', title: 'API', status: 'decided', dependsOn: ['storage'] },
    { id: 'client', title: 'Client', status: 'decided', dependsOn: ['api'] },
    { id: 'schema', title: 'Schema', status: 'decided', parent: 'storage' },
  ])
  const r = cli(p, ['reopen', 'storage', '--reason', 'rejected', '--actor', 'you'])
  expect(r.code, r.out).toBe(0)
  const stale = cli(p, ['stale']).out
  console.log('05.2 stale after reopen:\n' + stale)
  for (const id of ['api', 'schema']) {
    const line = lineOf(stale, id)
    expect.soft(line, `${id} listed as stale`).toMatch(/STALE/)
    expect.soft(line, `${id} listed with the reason rejected`).toMatch(/rejected/)
    expect.soft(line, `${id} listed with a trace naming the reopen of storage`).toMatch(/storage/i)
  }
  console.log('05.2 show api:\n' + cli(p, ['show', 'api']).out)
  expect.soft(lineOf(stale, 'client'), 'no mark on client').toBe('')

  server = await serve(p, 5102)
  await page.goto(`${server.url}/`)
  await expect.soft(card(page, 'api')).toHaveClass(/is-stale/)
  expect.soft(await leftColor(page, 'api'), 'api drawn red').toBe(RED)
  await expect.soft(card(page, 'client')).not.toHaveClass(/is-stale/)
  await page.goto(`${server.url}/map/storage`)
  await expect.soft(card(page, 'schema')).toHaveClass(/is-stale/)
  expect.soft(await leftColor(page, 'schema'), 'schema drawn red').toBe(RED)
  for (const id of ['api', 'schema']) {
    await page.goto(`${server.url}/map/${id}`)
    await expect.soft(page.locator('.hero'), `${id} hero red`).toHaveClass(/is-stale/)
    await expect.soft(page.locator('#sections'), `${id} card names the reason rejected`).toContainText(/storage\s+was rejected/)
  }

  // The person reviews API and amends it: a body edit, then the review that clears it.
  const ed = cli(p, ['edit', 'api', '--body', 'The API now reads the new storage layout.', '--actor', 'you'])
  expect(ed.code, ed.out).toBe(0)
  const rd = cli(p, ['rederive', 'api', '--actor', 'you'])
  expect(rd.code, rd.out).toBe(0)
  const after = cli(p, ['stale']).out
  console.log('05.2 stale after amend:\n' + after)
  expect.soft(lineOf(after, 'api'), 'api no longer stale').toBe('')
  expect.soft(lineOf(after, 'schema'), 'schema still stale').toMatch(/STALE/)
  expect.soft(lineOf(after, 'client'), 'client now stale').toMatch(/STALE/)
  expect.soft(lineOf(after, 'client'), 'client trace names the change to api').toMatch(/api/i)
  console.log('05.2 show client:\n' + cli(p, ['show', 'client']).out)
  await page.goto(`${server.url}/`)
  await expect.soft(card(page, 'api')).not.toHaveClass(/is-stale/)
  await expect.soft(card(page, 'client'), 'client drawn stale in browser').toHaveClass(/is-stale/)
})

test('05.3 a postponed reopen marks every downstream card paused in grey and keeps its status colour', async ({ page }) => {
  const p = setup([
    { id: 'engine', title: 'Engine', status: 'decided', who: 'me', noBasis: true },
    { id: 'parser', title: 'Parser', status: 'decided', dependsOn: ['engine'] },
    { id: 'renderer', title: 'Renderer', status: 'open', dependsOn: ['parser'] },
    { id: 'export', title: 'Export', status: 'open', dependsOn: ['renderer'] },
  ])
  // Part of the given state: Engine carries the kill criterion a decided card needs.
  expect(cli(p, ['kill', 'engine', '--form', 'revisit']).code).toBe(0)
  const r = cli(p, ['reopen', 'engine', '--reason', 'postponed', '--actor', 'you'])
  expect(r.code, r.out).toBe(0)
  const listing = cli(p, ['stale']).out
  console.log('05.3 stale:\n' + listing)
  for (const id of ['parser', 'renderer', 'export']) {
    const line = lineOf(listing, id)
    expect.soft(line, `${id} listed as paused`).toMatch(/POSTPONED/)
    expect.soft(line, `${id} listed with the reason postponed and a trace to engine`).toMatch(/engine/i)
  }
  expect.soft(listing, 'no card stale').not.toMatch(/STALE/)

  server = await serve(p, 5103)
  await page.goto(`${server.url}/`)
  for (const id of ['parser', 'renderer', 'export']) {
    await expect.soft(card(page, id), `${id} paused mark`).toHaveClass(/is-postponed/)
    await expect.soft(card(page, id)).not.toHaveClass(/is-stale/)
    expect.soft(await bgImage(page, id), `${id} grey hatch`).toContain('repeating-linear-gradient')
  }
  expect.soft(await leftColor(page, 'parser'), 'parser keeps decided colour').toBe(DECIDED)
  expect.soft(await leftColor(page, 'renderer'), 'renderer keeps open colour').toBe(OPEN)

  // The person resumes the work on Engine: a later decision ends the postponement.
  const res = cli(p, ['status', 'engine', 'decided', '--actor', 'you'])
  console.log('05.3 resume:', res.code, res.out)
  expect(res.code, res.out).toBe(0)
  const after = cli(p, ['stale']).out
  console.log('05.3 stale after resume:\n' + after)
  expect.soft(after, 'no paused mark in the listing').not.toMatch(/POSTPONED/)
  await page.goto(`${server.url}/`)
  await expect.soft(page.locator('#sections .is-postponed'), 'no paused mark in the browser').toHaveCount(0)
})

test('05.4 stale wins when a postponement and an invalidation reach the same card', async ({ page }) => {
  const p = setup([
    { id: 'auth', title: 'Auth', status: 'decided' },
    { id: 'ledger', title: 'Ledger', status: 'decided' },
    { id: 'billing', title: 'Billing', status: 'decided', dependsOn: ['auth', 'ledger'] },
    { id: 'report', title: 'Report', status: 'decided', dependsOn: ['billing'] },
  ])
  expect(cli(p, ['reopen', 'auth', '--reason', 'postponed', '--actor', 'you']).code).toBe(0)
  expect(cli(p, ['reopen', 'ledger', '--reason', 'rejected', '--actor', 'you']).code).toBe(0)
  const listing = cli(p, ['stale']).out
  console.log('05.4 stale:\n' + listing)
  const billing = lineOf(listing, 'billing')
  expect.soft(billing, 'billing stale').toMatch(/STALE/)
  expect.soft(billing, 'billing reason rejected').toMatch(/rejected/)
  expect.soft(billing, 'billing trace names the reopen of ledger').toMatch(/ledger/i)
  const report = lineOf(listing, 'report')
  expect.soft(report, 'report paused').toMatch(/POSTPONED/)
  expect.soft(report, 'report reason postponed').toMatch(/postponed/)
  console.log('05.4 show billing:\n' + cli(p, ['show', 'billing']).out)
  console.log('05.4 show report:\n' + cli(p, ['show', 'report']).out)

  server = await serve(p, 5104)
  await page.goto(`${server.url}/`)
  await expect.soft(card(page, 'billing')).toHaveClass(/is-stale/)
  await expect.soft(card(page, 'billing')).not.toHaveClass(/is-postponed/)
  expect.soft(await leftColor(page, 'billing'), 'billing red').toBe(RED)
  expect.soft(await bgImage(page, 'billing'), 'billing not grey').not.toContain('repeating-linear-gradient')
  await expect.soft(card(page, 'report'), 'report paused in browser').toHaveClass(/is-postponed/)
})

test('05.5 clearing one stale mark leaves the other marks in place', async ({ page }) => {
  const p = setup([
    { id: 'index', title: 'Index', status: 'decided' },
    { id: 'search', title: 'Search', status: 'decided', dependsOn: ['index'] },
    { id: 'filters', title: 'Filters', status: 'decided', dependsOn: ['index'] },
  ])
  expect(cli(p, ['reopen', 'index', '--reason', 'rejected', '--actor', 'you']).code).toBe(0)
  const before = cli(p, ['stale']).out
  expect(lineOf(before, 'search')).toMatch(/STALE/)
  expect(lineOf(before, 'filters')).toMatch(/STALE/)

  const rd = cli(p, ['rederive', 'search', '--actor', 'you'])
  expect(rd.code, rd.out).toBe(0)
  const listing = cli(p, ['stale']).out
  console.log('05.5 stale:\n' + listing)
  expect.soft(lineOf(listing, 'search'), 'search no longer listed').toBe('')
  const filters = lineOf(listing, 'filters')
  expect.soft(filters, 'filters still stale').toMatch(/STALE/)
  expect.soft(filters, 'filters reason rejected').toMatch(/rejected/)
  expect.soft(filters, 'filters trace to the reopen of index').toMatch(/index/i)
  console.log('05.5 show filters:\n' + cli(p, ['show', 'filters']).out)

  server = await serve(p, 5105)
  await page.goto(`${server.url}/`)
  await expect.soft(card(page, 'search')).not.toHaveClass(/is-stale/)
  await expect.soft(card(page, 'filters')).toHaveClass(/is-stale/)
  await page.goto(`${server.url}/map/filters`)
  await expect.soft(page.locator('#sections')).toContainText(/index\s+was rejected/)
})
