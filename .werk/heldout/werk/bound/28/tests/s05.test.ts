import { afterAll, afterEach, expect, test } from 'bun:test'
import { closeBrowser, getBrowser, logEvents, makeProject, ok, startServe, type RunningServer, type TempProject } from './lib.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})
afterAll(closeBrowser)

const run = (...args: string[]) => {
  const r = project!.run(args)
  return { code: r.code, out: (r.stdout + r.stderr).trim() }
}
const card = (id: string) => JSON.parse(project!.run(['show', id]).stdout).card

type Entry = { id: string; state: 'stale' | 'paused'; reasons: string[]; marks: any[] }
/**
 * The staleness listing. werk has no dedicated listing command (`werk stale` is tried first). The fallback
 * reads every card's marks through `werk show <id>`: a card with marks counts as stale, since werk has no
 * paused state.
 */
function listing(ids: string[]): { dedicated: { code: number; out: string }; entries: Entry[] } {
  const dedicated = run('stale')
  const entries: Entry[] = []
  for (const id of ids) {
    const c = card(id)
    if (c.stale.length) entries.push({ id, state: 'stale', reasons: c.stale.map((m: any) => m.why), marks: c.stale })
    if (c.paused?.length) entries.push({ id, state: 'paused', reasons: c.paused.map((m: any) => m.why), marks: c.paused })
  }
  return { dedicated, entries }
}
const events = () => logEvents(project!.dir)

async function open(hash = '') {
  server ??= await startServe(project!.dir)
  const page = await (await getBrowser()).newPage()
  await page.goto(`http://localhost:${server.port}/${hash}`)
  await page.getByRole('main', { name: 'map' }).waitFor({ timeout: 15000 })
  return page
}

test('05.1 a reopen without a reason is refused and leaves the map unchanged', () => {
  project = makeProject()
  ok(project, 'add', 'pricing', '--title', 'Pricing')
  ok(project, 'add', 'checkout', '--title', 'Checkout')
  ok(project, 'link', 'checkout', 'pricing', '--type', 'depends_on')
  ok(project, 'decide', 'pricing')
  const reopen = run('reopen', 'pricing')
  const l = listing(['pricing', 'checkout'])
  console.log(JSON.stringify({ reopen, status: card('pricing').status, listing: l.entries, stale: l.dedicated.out.split('\n')[0] }))
  expect(reopen.code).not.toBe(0)
  expect(reopen.out).toMatch(/postponed/)
  expect(reopen.out).toMatch(/rejected/)
  expect(card('pricing').status).toBe('decided')
  expect(l.dedicated.code).toBe(0)
  expect(l.entries).toEqual([])
})

test('05.2 a rejected reopen marks only the next hop, and a review moves the mark one hop on', async () => {
  project = makeProject()
  ok(project, 'add', 'storage', '--title', 'Storage')
  ok(project, 'add', 'api', '--title', 'API')
  ok(project, 'add', 'client', '--title', 'Client')
  ok(project, 'add', 'schema', '--title', 'Schema', '--parent', 'storage')
  ok(project, 'link', 'api', 'storage', '--type', 'depends_on')
  ok(project, 'link', 'client', 'api', '--type', 'depends_on')
  ok(project, 'decide', 'storage')
  ok(project, 'reopen', 'storage', '--why', 'rejected')
  const reopenSeq = events().at(-1).seq
  const ids = ['storage', 'api', 'client', 'schema']
  const l1 = listing(ids)
  // Browser: the root page lists API; the Storage page lists Schema; each card page carries the reason.
  const page = await open()
  const apiItem = page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ hasText: 'API' })
  const apiMark = await apiItem.locator('.mark').evaluateAll((els) => els.map((e) => getComputedStyle(e).color))
  await page.goto(page.url().replace(/#.*$/, '') + '#storage')
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Storage')
  const schemaItem = page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ hasText: 'Schema' })
  const schemaMark = await schemaItem.locator('.mark').evaluateAll((els) => els.map((e) => getComputedStyle(e).color))
  await page.goto(page.url().replace(/#.*$/, '') + '#api')
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'API')
  const apiDetail = await page.getByRole('region', { name: 'card detail' }).innerText()
  await page.close()
  // The review of API amends it (an edit), then confirms it (a decide).
  const edit = run('edit', 'api', '--body', 'API amended after the Storage reopen')
  const editSeq = events().at(-1).seq
  const decide = run('decide', 'api')
  const l2 = listing(ids)
  console.log(JSON.stringify({ dedicated: l1.dedicated.out.split('\n')[0], l1: l1.entries, apiMark, schemaMark, apiDetail, edit, decide, l2: l2.entries }, null, 1))

  const stale1 = Object.fromEntries(l1.entries.map((e) => [e.id, e]))
  expect(Object.keys(stale1).sort()).toEqual(['api', 'schema'])
  for (const id of ['api', 'schema']) {
    expect(stale1[id]!.state).toBe('stale')
    expect(stale1[id]!.reasons).toEqual(['rejected'])
    expect(stale1[id]!.marks[0]).toMatchObject({ because: 'storage', seq: reopenSeq, via: id === 'api' ? 'depends_on' : 'refines' })
  }
  expect(apiMark).toEqual(['rgb(192, 57, 43)'])
  expect(schemaMark).toEqual(['rgb(192, 57, 43)'])
  expect(apiDetail).toContain('rejected')
  const stale2 = Object.fromEntries(l2.entries.map((e) => [e.id, e]))
  expect(stale2.api).toBeUndefined()
  expect(stale2.schema?.state).toBe('stale')
  expect(stale2.client?.state).toBe('stale')
  expect(stale2.client!.marks[0]).toMatchObject({ because: 'api', seq: editSeq })
  expect(l1.dedicated.code).toBe(0) // a staleness listing exists
}, 60_000)

test('05.3 a postponed reopen marks every downstream card as paused in grey, keeping its status colour', async () => {
  project = makeProject()
  ok(project, 'add', 'engine', '--title', 'Engine')
  ok(project, 'add', 'parser', '--title', 'Parser')
  ok(project, 'add', 'renderer', '--title', 'Renderer')
  ok(project, 'add', 'export', '--title', 'Export')
  ok(project, 'link', 'parser', 'engine', '--type', 'depends_on')
  ok(project, 'link', 'renderer', 'parser', '--type', 'depends_on')
  ok(project, 'link', 'export', 'renderer', '--type', 'depends_on')
  ok(project, 'decide', 'engine')
  ok(project, 'decide', 'parser')
  ok(project, 'reopen', 'engine', '--why', 'postponed')
  const ids = ['engine', 'parser', 'renderer', 'export']
  const l = listing(ids)
  const page = await open()
  const rows = await page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent, status: e.querySelector('.status')?.className, mark: e.querySelector('.mark')?.textContent ?? null })),
  )
  await page.close()
  console.log(JSON.stringify({ dedicated: l.dedicated.out.split('\n')[0], entries: l.entries, rows }, null, 1))
  expect(l.dedicated.code).toBe(0)
  const byId = Object.fromEntries(l.entries.map((e) => [e.id, e]))
  for (const id of ['parser', 'renderer', 'export']) {
    expect(byId[id]?.state).toBe('paused')
    expect(byId[id]?.reasons).toContain('postponed')
  }
  expect(l.entries.filter((e) => e.state === 'stale')).toEqual([])
  for (const name of ['Parser', 'Renderer', 'Export']) expect(rows.find((r) => r.text?.startsWith(name))?.mark).toMatch(/paused/)
})

test('05.4 stale wins when a postponement and an invalidation reach the same card', async () => {
  project = makeProject()
  for (const [id, title] of [['auth', 'Auth'], ['ledger', 'Ledger'], ['billing', 'Billing'], ['report', 'Report']]) ok(project, 'add', id!, '--title', title!)
  ok(project, 'link', 'billing', 'auth', '--type', 'depends_on')
  ok(project, 'link', 'billing', 'ledger', '--type', 'depends_on')
  ok(project, 'link', 'report', 'billing', '--type', 'depends_on')
  ok(project, 'decide', 'auth')
  ok(project, 'decide', 'ledger')
  ok(project, 'reopen', 'auth', '--why', 'postponed')
  ok(project, 'reopen', 'ledger', '--why', 'rejected')
  const l = listing(['auth', 'ledger', 'billing', 'report'])
  const page = await open()
  const billingMark = await page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ hasText: 'Billing' }).locator('.mark').evaluateAll((els) => els.map((e) => [e.textContent, getComputedStyle(e).color]))
  await page.close()
  console.log(JSON.stringify({ dedicated: l.dedicated.out.split('\n')[0], entries: l.entries, billingMark }, null, 1))
  expect(l.dedicated.code).toBe(0)
  const billing = l.entries.filter((e) => e.id === 'billing')
  expect(billing.map((e) => e.state)).toEqual(['stale'])
  expect(billing[0]!.reasons).toEqual(['rejected'])
  expect(billing[0]!.marks.map((m: any) => m.because)).toEqual(['ledger'])
  expect(billingMark.map((m) => m[1])).toEqual(['rgb(192, 57, 43)'])
  const report = l.entries.filter((e) => e.id === 'report')
  expect(report.map((e) => [e.state, e.reasons])).toEqual([['paused', ['postponed']]])
})

test('05.5 clearing one stale mark leaves the other marks in place', async () => {
  project = makeProject()
  for (const [id, title] of [['index', 'Index'], ['search', 'Search'], ['filters', 'Filters']]) ok(project, 'add', id!, '--title', title!)
  ok(project, 'link', 'search', 'index', '--type', 'depends_on')
  ok(project, 'link', 'filters', 'index', '--type', 'depends_on')
  ok(project, 'decide', 'index')
  ok(project, 'reopen', 'index', '--why', 'rejected')
  const reopenSeq = events().at(-1).seq
  const before = listing(['index', 'search', 'filters'])
  expect(before.entries.map((e) => e.id).sort()).toEqual(['filters', 'search'])
  // Review Search and confirm it unchanged: a decide, with no edit.
  const confirm = run('decide', 'search')
  const after = listing(['index', 'search', 'filters'])
  const page = await open()
  const rows = await page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').evaluateAll((els) =>
    els.map((e) => ({ text: e.querySelector('a')?.textContent, mark: e.querySelector('.mark')?.textContent?.trim() ?? null })),
  )
  await page.close()
  console.log(JSON.stringify({ dedicated: after.dedicated.out.split('\n')[0], confirm, after: after.entries, rows }, null, 1))
  expect(confirm.code).toBe(0)
  expect(after.entries.find((e) => e.id === 'search')).toBeUndefined()
  expect(rows.find((r) => r.text === 'Search')?.mark).toBeNull()
  const filters = after.entries.find((e) => e.id === 'filters')!
  expect(filters.state).toBe('stale')
  expect(filters.reasons).toEqual(['rejected'])
  expect(filters.marks[0]).toMatchObject({ because: 'index', seq: reopenSeq })
  expect(rows.find((r) => r.text === 'Filters')?.mark).toBe('stale')
  expect(after.dedicated.code).toBe(0) // a staleness listing exists
})
