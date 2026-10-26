import { expect, test } from 'bun:test'
import { Checks, decidedRoot, fixLines, logText, mustRun, open, project, runPrinted, serve, showCard, shows } from './lib.ts'

const report = (c: Checks, id: string) => {
  console.log(`\n=== ${id}\n${c.report()}`)
  expect(c.misses).toEqual([])
}

/** Fills the <...> placeholders of a printed command. */
const fill = (line: string, values: Record<string, string> = {}) =>
  line.replace(/<([^>]+)>/g, (_, name: string) => values[name] ?? 'filled in by the agent')

test('03.1 a missing kill criterion blocks decided, and the printed command fixes it', async () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'base', 'Use a log')
  mustRun(p, ['add', 'x', '--title', 'Fold the log into a map', '--who', 'you'])
  mustRun(p, ['link', 'x', 'base', '--type', 'depends_on', '--why', 'reads the log'])
  mustRun(p, ['add', 'x:opt0', '--kind', 'option', '--title', 'Store the map', '--why-not', 'two sources of truth', '--alternative-to', 'x'])
  const before = logText(p.dir)
  const r = p.run(['status', 'x', 'decided'])
  c.ok(r.code !== 0, `the command fails with a non-zero exit (${r.code})`)
  c.note(`stderr: ${r.stderr.trim()}`)
  c.ok(/kill criterion/.test(r.stderr), 'the output names the missing kill criterion')
  const fixes = fixLines(r.stderr)
  c.ok(fixes.length === 1 && fixes[0]!.startsWith('werk kill x'), `the output prints one command that adds it: ${JSON.stringify(fixes)}`)
  c.ok(showCard(p, 'x')?.card.status === 'open', 'the card still shows its earlier status (open) on the map')
  c.ok(logText(p.dir) === before, 'the log has no new event')
  const s = await serve(p.dir)
  const { page } = await open(s.port, '#x')
  c.ok(await shows(page, async () => (await page.locator('.meta .status').textContent()) === 'open'), 'the browser shows the card open')
  const fixed = runPrinted(p.dir, fill(fixes[0] ?? 'false', { 'what must become true to revisit this decision': 'the log grows past one file' }))
  c.ok(fixed.code === 0, `the printed command, filled in, runs (${fixed.code} ${fixed.stderr.trim()})`)
  const again = p.run(['status', 'x', 'decided'])
  c.ok(again.code === 0, `status decided succeeds now (${again.code} ${again.stderr.trim()})`)
  c.ok(showCard(p, 'x')?.card.status === 'decided', 'show prints decided')
  c.ok(await shows(page, async () => (await page.locator('.meta .status').textContent()) === 'decided'), 'the browser map shows the card decided')
  report(c, '03.1')
}, 60_000)

test('03.2 each missing fact prints its own fixing command', () => {
  const c = new Checks()
  const p = project()
  decidedRoot(p, 'base', 'Use a log')
  const option = (id: string) => mustRun(p, ['add', `${id}:opt0`, '--kind', 'option', '--title', `Not ${id}`, '--why-not', 'slower', '--alternative-to', id])
  const basis = (id: string) => mustRun(p, ['link', id, 'base', '--type', 'depends_on', '--why', 'reads the log'])
  const kill = (id: string) => mustRun(p, ['kill', id, 'revisit when the log changes'])
  // c1: no decider.
  mustRun(p, ['add', 'c1', '--title', 'Card one'])
  basis('c1'); option('c1'); kill('c1')
  // c2: no basis, no stated lack of one.
  mustRun(p, ['add', 'c2', '--title', 'Card two', '--who', 'you'])
  option('c2'); kill('c2')
  // c3: no options, no unchallenged flag.
  mustRun(p, ['add', 'c3', '--title', 'Card three', '--who', 'you'])
  basis('c3'); kill('c3')
  // c4: no kill criteria.
  mustRun(p, ['add', 'c4', '--title', 'Card four', '--who', 'you'])
  basis('c4'); option('c4')
  const expected: Record<string, RegExp> = { c1: /^werk edit c1 --who /, c2: /^werk link c2 .* --type depends_on/, c3: /^werk add c3:opt\d+ --kind option .*--alternative-to c3/, c4: /^werk kill c4 / }
  const printed: Record<string, string> = {}
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const before = logText(p.dir)
    const r = p.run(['status', id, 'decided'])
    const fixes = fixLines(r.stderr)
    c.ok(r.code !== 0 && logText(p.dir) === before, `${id}: the attempt fails (${r.code}) and appends no event`)
    c.ok(fixes.length === 1 && expected[id]!.test(fixes[0]!), `${id}: prints one command that supplies its fact: ${JSON.stringify(fixes)}`)
    printed[id] = fixes[0] ?? ''
  }
  c.ok(new Set(Object.values(printed).map((l) => l.split(' ')[1])).size === 4, 'the four commands differ (edit, link, add, kill)')
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const line = fill(printed[id]!, { 'you|me|prototype': 'you', 'card-it-needs': 'base' })
    const r = runPrinted(p.dir, line)
    c.ok(r.code === 0, `${id}: the printed command runs: ${line} (${r.code} ${r.stderr.trim()})`)
    const d = p.run(['status', id, 'decided'])
    c.ok(d.code === 0, `${id}: decided again succeeds (${d.code} ${d.stderr.trim()})`)
  }
  c.ok(['c1', 'c2', 'c3', 'c4'].every((id) => showCard(p, id)?.card.status === 'decided'), 'all four cards show as decided')
  report(c, '03.2')
})

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', async () => {
  const c = new Checks()
  const p = project()
  mustRun(p, ['add', 'x', '--title', 'Use a log', '--who', 'you'])
  mustRun(p, ['kill', 'x', 'revisit when the log grows past one file'])
  const nb = p.run(['edit', 'x', '--no-basis', 'the first decision of the project'])
  c.ok(nb.code === 0, `records no basis with a reason (${nb.code})`)
  const un = p.run(['edit', 'x', '--unchallenged', 'no other storage was on the table'])
  c.ok(un.code === 0, `records unchallenged (${un.code})`)
  const d = p.run(['status', 'x', 'decided'])
  c.ok(d.code === 0, `status decided succeeds (${d.code} ${d.stderr.trim()})`)
  const card = showCard(p, 'x')?.card
  c.ok(card?.status === 'decided' && card?.noBasis === 'the first decision of the project' && card?.unchallenged === 'no other storage was on the table', `show prints decided with the reason and the flag: ${JSON.stringify(card)}`)
  const s = await serve(p.dir)
  const { page } = await open(s.port, '#x')
  c.ok(await shows(page, async () => (await page.locator('.meta .status').textContent()) === 'decided'), 'the browser map shows the card decided')
  const text = await page.locator('main').innerText()
  c.note(`card page text: ${text.replace(/\n/g, ' | ')}`)
  c.ok(text.includes('the first decision of the project'), 'the browser map shows the stated no-basis reason')
  c.ok(/unchallenged/i.test(text), 'the browser map shows the unchallenged flag')
  report(c, '03.3')
}, 60_000)

test('03.4 an amend of a decided card cannot remove a required fact', async () => {
  const c = new Checks()
  const p = project()
  mustRun(p, ['add', 'x', '--title', 'Use a log', '--who', 'you', '--body', 'One JSON line per event.'])
  mustRun(p, ['edit', 'x', '--no-basis', 'the first decision'])
  mustRun(p, ['kill', 'x', 'revisit when the log grows past one file'])
  mustRun(p, ['add', 'x:opt0', '--kind', 'option', '--title', 'A database', '--why-not', 'a server to run', '--alternative-to', 'x'])
  mustRun(p, ['status', 'x', 'decided'])
  c.note(`usage of kill and edit: ${p.run(['help']).stdout.split('\n').filter((l) => /^\s+(kill|edit)/.test(l)).join(' / ')}`)
  const before = logText(p.dir)
  // No command removes a kill criterion; the nearest amend is to set the kill criterion to nothing.
  const tries = [['kill', 'x', ''], ['edit', 'x', '--kill', '']]
  let printedKill = false
  let anyFailed = true
  for (const args of tries) {
    const r = p.run(args)
    c.note(`werk ${args.map((a) => JSON.stringify(a)).join(' ')} -> exit ${r.code}: ${r.stderr.split('\n')[0]}`)
    anyFailed &&= r.code !== 0
    printedKill ||= fixLines(r.stderr).some((l) => l.startsWith('werk kill x'))
  }
  c.ok(anyFailed, 'the amend fails with a non-zero exit')
  c.ok(printedKill, 'the output prints the command that supplies the kill criteria')
  c.ok(logText(p.dir) === before, 'the log has no new amend event')
  const card = showCard(p, 'x')?.card
  c.ok(card?.status === 'decided' && card?.kill.length === 1, 'the map still shows the kill criterion and decided')
  const r = p.run(['edit', 'x', '--body', 'One JSON line per event, appended.'])
  c.ok(r.code === 0, `an amend of only the body succeeds (${r.code} ${r.stderr.trim()})`)
  c.ok(showCard(p, 'x')?.card.body === 'One JSON line per event, appended.', 'show prints the new text')
  const s = await serve(p.dir)
  const { page } = await open(s.port, '#x')
  c.ok(await shows(page, async () => (await page.locator('.body').textContent()) === 'One JSON line per event, appended.'), 'the browser map shows the new text')
  report(c, '03.4')
}, 60_000)

test('03.5 adding a card and setting it open are not checked', () => {
  const c = new Checks()
  const p = project()
  const a = p.run(['add', 'x', '--title', 'Use a log', '--body', 'One JSON line per event.'])
  c.ok(a.code === 0, `add with only title and body succeeds (${a.code})`)
  c.ok(showCard(p, 'x')?.card.status === 'open', 'the card shows on the map')
  const tries = [['status', 'x', 'open'], ['status', 'x', 'open', '--reason', 'postponed', '--why', 'set open']]
  const results = tries.map((args) => ({ args, ...p.run(args) }))
  for (const r of results) c.note(`werk ${r.args.join(' ')} -> exit ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(results.some((r) => r.code === 0), 'setting the card to open succeeds')
  c.ok(showCard(p, 'x')?.card.status === 'open', 'the card shows as open')
  const d = p.run(['status', 'x', 'decided'])
  c.ok(d.code !== 0, `setting it decided fails (${d.code})`)
  c.ok(showCard(p, 'x')?.card.status === 'open', 'the card stays open')
  report(c, '03.5')
})
