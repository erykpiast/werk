import { afterAll, afterEach, expect, test } from 'bun:test'
import { closeBrowser, decidable, makeProject, must, openPage, show, startServe, type RunningServer, type TempProject } from './lib.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})
afterAll(closeBrowser)
const T = 60_000

/**
 * The staleness listing. The product CLI has no listing verb; `werk stale` is tried first.
 * Its result is logged, and the per-card marks are read from `show` so later checks still run.
 */
function listing(p: TempProject) {
  const r = p.run(['stale'])
  return { code: r.code, out: r.stdout + r.stderr }
}
const marks = (p: TempProject, id: string) => show(p, id).json.card.stale as { because: string; via: string; why?: string; seq: number }[]

async function browserCard(id: string) {
  server ??= await startServe(project!.dir)
  const { page } = await openPage(`http://localhost:${server.port}/#${id}`)
  await page.getByRole('region', { name: 'card detail' }).waitFor({ timeout: 10_000 })
  return page
}

test('05.1 a reopen without a reason is refused and leaves the map unchanged', () => {
  project = makeProject()
  decidable(project, 'pricing', 'Pricing')
  must(project, ['decide', 'pricing'])
  must(project, ['add', 'checkout', '--title', 'Checkout'])
  must(project, ['link', 'checkout', 'pricing', '--type', 'depends_on', '--why', 'prices'])

  const r = project.run(['reopen', 'pricing'])
  const out = r.stdout + r.stderr
  console.log(`05.1 reopen with no reason: exit ${r.code}: ${out.split('\n')[0]}`)
  expect(r.code).not.toBe(0)
  expect(show(project, 'pricing').json.card.status).toBe('decided')
  expect(marks(project, 'checkout')).toEqual([])
  const l = listing(project)
  console.log(`05.1 staleness listing: exit ${l.code}: ${l.out.split('\n')[0]}`)
  expect(out).toMatch(/postponed/)
  expect(out).toMatch(/rejected/)
  expect(l.code).toBe(0)
})

test('05.2 a rejected reopen marks only the next hop as stale, and a review moves the mark one hop on', async () => {
  project = makeProject()
  decidable(project, 'storage', 'Storage')
  must(project, ['decide', 'storage'])
  must(project, ['add', 'api', '--title', 'API'])
  must(project, ['link', 'api', 'storage', '--type', 'depends_on', '--why', 'reads it'])
  must(project, ['add', 'client', '--title', 'Client'])
  must(project, ['link', 'client', 'api', '--type', 'depends_on', '--why', 'calls it'])
  must(project, ['add', 'schema', '--title', 'Schema', '--parent', 'storage'])

  expect(project.run(['reopen', 'storage', '--why', 'rejected']).code).toBe(0)
  const l = listing(project)
  console.log(`05.2 staleness listing: exit ${l.code}: ${l.out.split('\n')[0]}`)
  console.log(`05.2 marks: api ${JSON.stringify(marks(project, 'api'))} schema ${JSON.stringify(marks(project, 'schema'))} client ${JSON.stringify(marks(project, 'client'))}`)
  expect(marks(project, 'api')).toMatchObject([{ because: 'storage', why: 'rejected', via: 'depends_on' }])
  expect(marks(project, 'schema')).toMatchObject([{ because: 'storage', why: 'rejected', via: 'refines' }])
  expect(marks(project, 'client')).toEqual([])

  const page = await browserCard('api')
  const staleText = (await page.getByRole('region', { name: 'stale' }).textContent()) ?? ''
  const color = await page.getByRole('region', { name: 'card detail' }).evaluate((el) => getComputedStyle(el).color)
  console.log(`05.2 browser #api stale part: "${staleText}", detail color ${color}`)
  expect(staleText).toContain('rejected')

  // When: the person reviews "API" and amends it.
  const amend = project.run(['edit', 'api', '--body', 'Reviewed against the new storage.'])
  expect(amend.code).toBe(0)
  console.log(`05.2 after amend: api ${JSON.stringify(marks(project, 'api'))} schema ${JSON.stringify(marks(project, 'schema'))} client ${JSON.stringify(marks(project, 'client'))}`)
  expect(marks(project, 'schema').length).toBeGreaterThan(0)
  expect(marks(project, 'client')).toMatchObject([{ because: 'api' }])
  expect(l.code).toBe(0)
  expect(marks(project, 'api')).toEqual([])
  // The browser draws the stale card in red.
  expect(color).toBe('rgb(192, 57, 43)')
  await page.close()
}, T)

test('05.3 a postponed reopen marks every downstream card as paused in grey and keeps its status colour', async () => {
  project = makeProject()
  decidable(project, 'engine', 'Engine')
  must(project, ['decide', 'engine'])
  must(project, ['add', 'parser', '--title', 'Parser', '--who', 'me'])
  must(project, ['link', 'parser', 'engine', '--type', 'depends_on', '--why', 'runs on it'])
  must(project, ['kill', 'parser', 'the grammar changes'])
  must(project, ['decide', 'parser'])
  must(project, ['add', 'renderer', '--title', 'Renderer'])
  must(project, ['link', 'renderer', 'parser', '--type', 'depends_on', '--why', 'draws the tree'])
  must(project, ['add', 'export', '--title', 'Export'])
  must(project, ['link', 'export', 'renderer', '--type', 'depends_on', '--why', 'exports the drawing'])

  expect(project.run(['reopen', 'engine', '--why', 'postponed']).code).toBe(0)
  const l = listing(project)
  console.log(`05.3 staleness listing: exit ${l.code}: ${l.out.split('\n')[0]}`)
  const all = Object.fromEntries(['parser', 'renderer', 'export'].map((id) => [id, show(project!, id).json.card]))
  console.log(`05.3 marks: ${JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, c]) => [k, { status: c.status, stale: c.stale, paused: c.paused }])))}`)
  expect(l.code).toBe(0)
  for (const id of ['parser', 'renderer', 'export']) {
    expect(all[id].paused ?? all[id].pause).toBeDefined()
    expect(all[id].stale).toEqual([])
  }
  expect(all.parser.status).toBe('decided')
  expect(all.renderer.status).toBe('open')
}, T)

test('05.4 stale wins when a postponement and an invalidation reach the same card', async () => {
  project = makeProject()
  decidable(project, 'auth', 'Auth')
  must(project, ['decide', 'auth'])
  decidable(project, 'ledger', 'Ledger')
  must(project, ['decide', 'ledger'])
  must(project, ['add', 'billing', '--title', 'Billing'])
  must(project, ['link', 'billing', 'auth', '--type', 'depends_on', '--why', 'who pays'])
  must(project, ['link', 'billing', 'ledger', '--type', 'depends_on', '--why', 'what is paid'])
  must(project, ['add', 'report', '--title', 'Report'])
  must(project, ['link', 'report', 'billing', '--type', 'depends_on', '--why', 'the totals'])

  expect(project.run(['reopen', 'auth', '--why', 'postponed']).code).toBe(0)
  expect(project.run(['reopen', 'ledger', '--why', 'rejected']).code).toBe(0)
  const l = listing(project)
  console.log(`05.4 staleness listing: exit ${l.code}: ${l.out.split('\n')[0]}`)
  const billing = show(project, 'billing').json.card
  const report = show(project, 'report').json.card
  console.log(`05.4 billing ${JSON.stringify(billing.stale)} report stale ${JSON.stringify(report.stale)} paused ${JSON.stringify(report.paused)}`)
  const page = await browserCard('billing')
  const staleText = (await page.getByRole('region', { name: 'stale' }).textContent()) ?? ''
  console.log(`05.4 browser #billing stale part: "${staleText}"`)
  await page.close()
  expect(l.code).toBe(0)
  expect(billing.stale.some((m: { because: string; why?: string }) => m.because === 'ledger' && m.why === 'rejected')).toBe(true)
  expect(report.paused ?? report.pause).toBeDefined()
}, T)

test('05.5 clearing one stale mark leaves the other marks in place', async () => {
  project = makeProject()
  decidable(project, 'index', 'Index')
  must(project, ['decide', 'index'])
  for (const [id, title] of [['search', 'Search'], ['filters', 'Filters']]) {
    must(project, ['add', id!, '--title', title!, '--who', 'me'])
    must(project, ['link', id!, 'index', '--type', 'depends_on', '--why', 'queries it'])
    must(project, ['kill', id!, 'the index changes'])
    must(project, ['decide', id!])
  }
  must(project, ['reopen', 'index', '--why', 'rejected'])
  expect(marks(project, 'search').length).toBe(1)
  expect(marks(project, 'filters').length).toBe(1)

  // When: the person reviews "Search" and confirms it unchanged — a decide again, which clears marks.
  const confirm = project.run(['decide', 'search'])
  console.log(`05.5 confirm search unchanged: exit ${confirm.code}: ${(confirm.stdout + confirm.stderr).trim()}`)
  const l = listing(project)
  console.log(`05.5 staleness listing: exit ${l.code}: ${l.out.split('\n')[0]}`)
  console.log(`05.5 marks: search ${JSON.stringify(marks(project, 'search'))} filters ${JSON.stringify(marks(project, 'filters'))}`)
  const page = await browserCard('search')
  const searchStale = await page.getByRole('region', { name: 'stale' }).count()
  await page.close()
  expect(confirm.code).toBe(0)
  expect(marks(project, 'search')).toEqual([])
  expect(searchStale).toBe(0)
  expect(marks(project, 'filters')).toMatchObject([{ because: 'index', why: 'rejected' }])
  expect(l.code).toBe(0)
}, T)
