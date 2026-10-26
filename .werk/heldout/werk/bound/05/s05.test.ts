import { expect, test } from 'bun:test'
import { Checks, decidedRoot, logText, mustRun, open, project, serve, showCard, shows, type Page, type TempProject } from './lib.ts'

const report = (c: Checks, id: string) => {
  console.log(`\n=== ${id}\n${c.report()}`)
  expect(c.misses).toEqual([])
}

const RED = 'rgb(192, 57, 43)'
const GREY = 'rgb(138, 138, 138)'
const GREEN = 'rgb(46, 139, 87)'

/** A card that passes the decide check through its depends_on basis. */
function decidedOn(p: TempProject, id: string, title: string, on: string[]) {
  mustRun(p, ['add', id, '--title', title, '--who', 'me'])
  for (const to of on) mustRun(p, ['link', id, to, '--type', 'depends_on', '--why', `${id} reads ${to}`])
  mustRun(p, ['kill', id, 'revisit when the basis changes'])
  mustRun(p, ['decide', id])
}

/** The staleness listing: card id -> { kind, lines }. */
function listing(p: TempProject) {
  const out = p.run(['stale']).stdout
  const rows: Record<string, { kind: string; traces: string[] }> = {}
  let cur: string | undefined
  for (const line of out.split('\n')) {
    const m = line.match(/^(stale|paused|review)\s+#(\S+)\s/)
    if (m) {
      cur = m[2]!
      rows[cur] = { kind: m[1]!, traces: [] }
    } else if (cur && line.trim()) rows[cur]!.traces.push(line.trim())
  }
  return { out, rows }
}

/** The mark a card page shows: its text and colour. */
async function pageMark(page: Page, port: number, id: string) {
  await page.goto(`http://localhost:${port}/#${id}`)
  await shows(page, async () => (await page.locator('.meta').count()) > 0)
  const mark = page.locator('.meta .mark')
  const status = page.locator('.meta .status')
  return {
    mark: (await mark.count()) ? { text: await mark.textContent(), color: await mark.evaluate((e) => getComputedStyle(e).color), cls: await mark.getAttribute('class') } : undefined,
    status: { text: await status.textContent(), color: await status.evaluate((e) => getComputedStyle(e).color) },
  }
}

test('05.1 a reopen without a reason is refused and leaves the map unchanged', () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'pricing', 'Pricing')
  decidedOn(p, 'checkout', 'Checkout', ['pricing'])
  const before = logText(p.dir)
  const r = p.run(['reopen', 'pricing'])
  c.note(`werk reopen pricing -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code !== 0, 'the reopen is refused')
  c.ok(/reason/.test(r.stderr) && /required|needs/.test(r.stderr) && /postponed/.test(r.stderr) && /rejected/.test(r.stderr), 'the message says a reason of postponed or rejected is required (the error line names --reason; the usage under it names postponed|rejected)')
  const r2 = p.run(['status', 'pricing', 'open'])
  c.note(`werk status pricing open -> ${r2.code}: ${r2.stderr.split('\n')[0]}`)
  c.ok(r2.code !== 0, 'status open with no reason is refused too')
  c.ok(logText(p.dir) === before, 'the log is unchanged')
  c.ok(showCard(p, 'pricing')?.card.status === 'decided', 'Pricing is still decided')
  const l = listing(p)
  c.ok(Object.keys(l.rows).length === 0 && /nothing is marked/.test(l.out), `the staleness listing shows no marked cards: ${l.out.trim()}`)
  report(c, '05.1')
})

test('05.2 a rejected reopen marks the next hop stale, and a review moves the mark one hop on', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'storage', 'Storage')
  decidedOn(p, 'api', 'API', ['storage'])
  decidedOn(p, 'client', 'Client', ['api'])
  mustRun(p, ['add', 'schema', '--title', 'Schema', '--parent', 'storage', '--who', 'me'])
  mustRun(p, ['kill', 'schema', 'revisit when storage changes'])
  mustRun(p, ['decide', 'schema'])
  const r = p.run(['reopen', 'storage', '--reason', 'rejected', '--why', 'the store loses writes'])
  c.ok(r.code === 0, `reopen storage rejected (${r.code} ${r.stderr.trim()})`)
  let l = listing(p)
  c.note(`stale listing:\n${l.out}`)
  c.ok(l.rows.api?.kind === 'stale' && l.rows.api.traces.some((t) => t.includes('#storage reopened, rejected') && t.includes('over depends_on')), 'API is stale, reason rejected, trace names the reopen of Storage and depends_on')
  c.ok(l.rows.schema?.kind === 'stale' && l.rows.schema.traces.some((t) => t.includes('#storage reopened, rejected') && t.includes('over refines')), 'Schema is stale, reason rejected, trace names the reopen of Storage and refines')
  c.ok(!l.rows.client, 'no mark on Client')
  const s = await serve(p.dir)
  const { page } = await open(s.port)
  for (const id of ['api', 'schema']) {
    const m = await pageMark(page, s.port, id)
    c.ok(m.mark?.color === RED && m.mark.text === 'stale: rejected', `the browser draws ${id} red with "rejected" on the card: ${JSON.stringify(m.mark)}`)
  }
  // The review: the person amends API, and decides it again.
  const amend = p.run(['edit', 'api', '--body', 'The API retries a lost write.'])
  c.note(`amend api -> ${amend.code}: ${amend.stderr.split('\n').slice(0, 3).join(' / ')}`)
  const review = p.run(['decide', 'api'])
  c.note(`review (decide) api -> ${review.code}: ${review.stderr.split('\n').slice(0, 3).join(' / ')}`)
  c.ok(amend.code === 0 && review.code === 0, 'the review and the amend of API go through')
  l = listing(p)
  c.note(`stale listing after:\n${l.out}`)
  c.ok(!l.rows.api, 'API no longer shows as stale')
  c.ok(l.rows.schema?.kind === 'stale', 'Schema still shows as stale')
  c.ok(l.rows.client?.kind === 'stale' && l.rows.client.traces.some((t) => t.startsWith('#api ')), 'Client is stale with a trace that names the change to API')
  const mApi = await pageMark(page, s.port, 'api')
  c.ok(mApi.mark === undefined, `the browser shows no mark on API: ${JSON.stringify(mApi.mark)}`)
  report(c, '05.2')
}, 60_000)

test('05.3 a postponed reopen pauses every downstream card in grey and keeps its status colour', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'engine', 'Engine')
  decidedOn(p, 'parser', 'Parser', ['engine'])
  mustRun(p, ['add', 'renderer', '--title', 'Renderer'])
  mustRun(p, ['link', 'renderer', 'parser', '--type', 'depends_on'])
  mustRun(p, ['add', 'export', '--title', 'Export'])
  mustRun(p, ['link', 'export', 'renderer', '--type', 'depends_on'])
  const r = p.run(['reopen', 'engine', '--reason', 'postponed', '--why', 'not this quarter'])
  c.ok(r.code === 0, `reopen engine postponed (${r.code} ${r.stderr.trim()})`)
  let l = listing(p)
  c.note(`listing:\n${l.out}`)
  for (const id of ['parser', 'renderer', 'export']) {
    c.ok(l.rows[id]?.kind === 'paused' && l.rows[id]!.traces.some((t) => t.startsWith('#engine reopened, postponed')), `${id} is paused, reason postponed, trace back to Engine`)
  }
  c.ok(!Object.values(l.rows).some((r) => r.kind === 'stale'), 'no card shows as stale')
  const s = await serve(p.dir)
  const { page } = await open(s.port)
  const ms: Record<string, any> = {}
  for (const id of ['parser', 'renderer', 'export']) {
    ms[id] = await pageMark(page, s.port, id)
    c.ok(ms[id].mark?.color === GREY && /paused/.test(ms[id].mark.text), `the browser draws ${id} with a grey paused mark: ${JSON.stringify(ms[id].mark)}`)
  }
  c.ok(ms.parser.status.text === 'decided' && ms.parser.status.color === GREEN, `Parser keeps the decided colour: ${JSON.stringify(ms.parser.status)}`)
  c.ok(ms.renderer.status.text === 'open' && ms.renderer.status.color !== GREY, `Renderer keeps the open colour: ${JSON.stringify(ms.renderer.status)}`)
  // On the root page list as well.
  await page.goto(`http://localhost:${s.port}/`)
  await shows(page, async () => (await page.getByRole('region', { name: 'sub-cards' }).count()) > 0)
  const row = (t: string) => page.getByRole('region', { name: 'sub-cards' }).locator('li', { has: page.getByRole('link', { name: t, exact: true }) })
  for (const t of ['Parser', 'Renderer', 'Export']) c.ok((await row(t).getAttribute('class')) === 'paused', `the root list draws ${t} paused`)
  const resume = p.run(['decide', 'engine'])
  c.ok(resume.code === 0, `resume (decide) engine (${resume.code} ${resume.stderr.trim()})`)
  l = listing(p)
  c.ok(Object.keys(l.rows).length === 0, `no paused mark in the listing: ${l.out.trim()}`)
  for (const t of ['Parser', 'Renderer', 'Export']) c.ok(await shows(page, async () => (await row(t).getAttribute('class')) !== 'paused'), `the browser no longer draws ${t} paused`)
  c.ok(await shows(page, async () => (await page.getByRole('region', { name: 'staleness' }).count()) === 0), 'the browser listing has no marked cards')
  report(c, '05.3')
}, 60_000)

test('05.4 stale wins when a postponement and an invalidation reach the same card', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'auth', 'Auth')
  decidedRoot(p, 'ledger', 'Ledger')
  mustRun(p, ['add', 'billing', '--title', 'Billing'])
  mustRun(p, ['link', 'billing', 'auth', '--type', 'depends_on'])
  mustRun(p, ['link', 'billing', 'ledger', '--type', 'depends_on'])
  mustRun(p, ['add', 'report', '--title', 'Report'])
  mustRun(p, ['link', 'report', 'billing', '--type', 'depends_on'])
  mustRun(p, ['reopen', 'auth', '--reason', 'postponed', '--why', 'waits for SSO'])
  mustRun(p, ['reopen', 'ledger', '--reason', 'rejected', '--why', 'double entry is wrong'])
  const l = listing(p)
  c.note(`listing:\n${l.out}`)
  c.ok(l.rows.billing?.kind === 'stale' && l.rows.billing.traces.some((t) => t.startsWith('#ledger reopened, rejected')), 'Billing is stale, reason rejected, trace names the reopen of Ledger')
  c.ok(l.rows.report?.kind === 'paused' && l.rows.report.traces.some((t) => t.includes('postponed')), 'Report is paused with the reason postponed')
  const s = await serve(p.dir)
  const { page } = await open(s.port)
  const m = await pageMark(page, s.port, 'billing')
  c.ok(m.mark?.color === RED && /stale/.test(m.mark.text ?? ''), `the browser draws Billing red, not grey: ${JSON.stringify(m.mark)}`)
  const mr = await pageMark(page, s.port, 'report')
  c.ok(mr.mark?.color === GREY && /paused: postponed/.test(mr.mark.text ?? ''), `the browser shows Report paused, postponed: ${JSON.stringify(mr.mark)}`)
  report(c, '05.4')
}, 60_000)

test('05.5 clearing one stale mark leaves the other marks in place', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'index', 'Index')
  decidedOn(p, 'search', 'Search', ['index'])
  decidedOn(p, 'filters', 'Filters', ['index'])
  mustRun(p, ['reopen', 'index', '--reason', 'rejected', '--why', 'the index is too slow'])
  let l = listing(p)
  c.ok(l.rows.search?.kind === 'stale' && l.rows.filters?.kind === 'stale', 'Search and Filters show as stale')
  const s = await serve(p.dir)
  const { page } = await open(s.port)
  const review = p.run(['decide', 'search'])
  c.note(`review (decide, unchanged) search -> ${review.code}: ${review.stderr.split('\n').slice(0, 3).join(' / ')}`)
  c.ok(review.code === 0, 'the person confirms Search unchanged')
  l = listing(p)
  c.note(`listing after:\n${l.out}`)
  c.ok(!l.rows.search, 'Search no longer shows as stale in the listing')
  const ms = await pageMark(page, s.port, 'search')
  c.ok(ms.mark === undefined, `Search shows no stale mark in the browser: ${JSON.stringify(ms.mark)}`)
  c.ok(l.rows.filters?.kind === 'stale' && l.rows.filters.traces.some((t) => t.startsWith('#index reopened, rejected')), 'Filters still stale with reason rejected and trace to Index')
  report(c, '05.5')
}, 60_000)
