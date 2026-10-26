import { expect, test } from 'bun:test'
import { Checks, decidedRoot, logEvents, logText, mustRun, open, project, serve, showCard, shows } from './lib.ts'

const report = (c: Checks, id: string) => {
  console.log(`\n=== ${id}\n${c.report()}`)
  expect(c.misses).toEqual([])
}

/** Whether a card row on the page looks like a ghost: grey and dashed. */
async function ghostStyle(page: any, title: string) {
  const link = page.getByRole('link', { name: title, exact: true }).first()
  if ((await link.count()) === 0) return { found: false, dashed: false, cls: '' }
  return link.evaluate((el: HTMLElement) => {
    const nodes = [el, el.parentElement!]
    const dashed = nodes.some((n) => getComputedStyle(n).borderStyle.includes('dashed') || getComputedStyle(n).outlineStyle.includes('dashed'))
    return { found: true, dashed, cls: `${el.className} / ${el.parentElement!.className}` }
  })
}

test('04.1 an agent card waits as a ghost until the person accepts it', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'checkout', 'Checkout flow')
  const s = await serve(p.dir)
  const { page } = await open(s.port, '#checkout')
  await shows(page, async () => (await page.getByRole('heading', { level: 1 }).textContent()) === 'Checkout flow')
  const before = logEvents(p.dir).length
  const r = p.run(['add', 'retry', '--title', 'Retry payment', '--parent', 'checkout'])
  c.note(`add output: ${r.stdout.trim()} ${r.stderr.trim()}`)
  c.ok(/proposed/.test(r.stdout) && !/added/.test(r.stdout), 'the add output says "proposed", not "added"')
  const ev = logEvents(p.dir).slice(before)
  c.ok(ev.length === 1 && /propos/.test(ev[0].type), `the log has a new proposed event: ${JSON.stringify(ev)}`)
  await shows(page, () => page.getByRole('link', { name: 'Retry payment' }).isVisible())
  const g = await ghostStyle(page, 'Retry payment')
  c.ok(g.found && g.dashed && /ghost|propos/.test(g.cls), `the browser shows "Retry payment" as a grey dashed ghost: ${JSON.stringify(g)}`)
  const accept = await page.getByRole('button', { name: /✓|accept/i }).count()
  c.ok(accept > 0, `the page has a ✓ control (found ${accept})`)
  report(c, '04.1')
}, 60_000)

test('04.2 accepting a ghost child accepts its ghost parent, and its held edge goes live', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'payments', 'Payments')
  decidedRoot(p, 'fraud', 'Fraud rules')
  const steps = [
    ['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'],
    ['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'],
    ['link', 'partial', 'fraud', '--type', 'depends_on', '--why', 'limits refunds'],
    ['add', 'partial:opt0', '--kind', 'option', '--title', 'Full refunds only', '--why-not', 'customers ask for part', '--alternative-to', 'partial'],
    ['add', 'partial:src0', '--kind', 'source', '--title', 'Support tickets'],
  ]
  for (const args of steps) {
    const r = p.run(args)
    c.note(`werk ${args.slice(0, 2).join(' ')} -> ${r.code} ${r.stdout.trim()}${r.stderr.trim()}`)
  }
  const page = showCard(p, 'partial')
  c.ok(page?.card && /ghost|propos/.test(JSON.stringify(page.card)), `"Partial refunds" is a ghost: ${JSON.stringify(page?.card)}`)
  const before = logEvents(p.dir).length
  const acc = p.run(['accept', 'partial', '--actor', 'you'])
  c.ok(acc.code === 0, `an accept of "Partial refunds" exists and succeeds (${acc.code} ${acc.stderr.split('\n')[0]})`)
  c.ok(logEvents(p.dir).length === before + 1, 'one accept event')
  report(c, '04.2')
}, 60_000)

test('04.3 discarding a ghost parent drops its ghost children', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'onboarding', 'Onboarding')
  mustRun(p, ['add', 'email', '--title', 'Email verification', '--parent', 'onboarding'])
  mustRun(p, ['add', 'resend', '--title', 'Resend email', '--parent', 'email'])
  const d = p.run(['discard', 'email'])
  c.ok(d.code === 0, `discard of "Email verification" exists and succeeds (${d.code} ${d.stderr.split('\n')[0]})`)
  const s = await serve(p.dir)
  const { page } = await open(s.port, '#onboarding')
  await shows(page, async () => (await page.getByRole('heading', { level: 1 }).textContent()) === 'Onboarding')
  const text = await page.locator('main').innerText()
  c.ok(!text.includes('Email verification') && !text.includes('Resend email'), `the browser shows neither card: ${text.replace(/\n/g, ' | ')}`)
  report(c, '04.3')
}, 60_000)

test('04.4 the words of a ghost are frozen, but it can be decided before acceptance', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'search', 'Search')
  mustRun(p, ['add', 'index', '--title', 'Search index', '--parent', 'search', '--body', 'An inverted index.'])
  const again = p.run(['add', 'index', '--title', 'Search index v2', '--parent', 'search'])
  c.ok(again.code !== 0 && showCard(p, 'index')?.card.title === 'Search index', `a second add with the same id refuses and the first words stay (${again.stderr.trim()})`)
  for (const args of [['edit', 'index', '--body', 'changed'], ['edit', 'index', '--why', 'changed'], ['retitle', 'index', 'changed']]) {
    const r = p.run(args)
    c.ok(r.code !== 0, `werk ${args.join(' ')} refuses on a ghost (exit ${r.code})`)
  }
  c.ok(showCard(p, 'index')?.card.title === 'Search index', `the ghost text did not change: ${showCard(p, 'index')?.card.title}`)
  report(c, '04.4')
}, 60_000)

test('04.5 an accept from the command line needs the statement that the person asked for it', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'root', 'Compliance')
  mustRun(p, ['add', 'audit', '--title', 'Audit log', '--parent', 'root'])
  const before = logText(p.dir)
  const r = p.run(['accept', 'audit'])
  c.note(`werk accept audit -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code !== 0, 'the accept without the statement exits with a failure')
  c.ok(logText(p.dir) === before, 'the log has no new event')
  const s = await serve(p.dir)
  const { page } = await open(s.port, '#root')
  await shows(page, () => page.getByRole('link', { name: 'Audit log' }).isVisible())
  const g = await ghostStyle(page, 'Audit log')
  c.ok(g.found && g.dashed, `the browser shows "Audit log" as a ghost: ${JSON.stringify(g)}`)
  const ok = p.run(['accept', 'audit', '--actor', 'you'])
  c.ok(ok.code === 0, `the accept with the statement succeeds (${ok.code}: ${ok.stderr.split('\n')[0]})`)
  report(c, '04.5')
}, 60_000)
