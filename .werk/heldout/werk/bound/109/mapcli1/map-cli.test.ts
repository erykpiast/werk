import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

const logLines = (p: Project) => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}
const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`setup failed: werk ${args.join(' ')} -> ${r.code}\n${r.stdout}${r.stderr}`)
  return r
}
/** Runs a verb; checks success and exactly one more line at the end, earlier lines unchanged. */
const appendsOne = (p: Project, args: string[]) => {
  const before = logLines(p)
  const r = p.werk(args)
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
/** Runs a verb; checks failure and no new event. */
const refuses = (p: Project, args: string[]) => {
  const before = logLines(p)
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  return r
}
const show = (p: Project, id: string) => p.werk(['show', id])
const statusOf = (p: Project, id: string) => show(p, id).stdout.match(/^status: (\S+)/m)?.[1]
const isGhost = (out: string) => out.includes('state: ghost')
const isReal = (out: string) => /^state: real$/m.test(out)

/** Splits a printed shell command into argv lists, one per `&&` part. Handles double quotes. */
function parseCommand(line: string): string[][] {
  const tokens: string[] = []
  let cur = ''
  let inQ = false
  let has = false
  for (const ch of line.trim()) {
    if (ch === '"') { inQ = !inQ; has = true; continue }
    if (!inQ && /\s/.test(ch)) { if (has) tokens.push(cur); cur = ''; has = false; continue }
    cur += ch; has = true
  }
  if (has) tokens.push(cur)
  const cmds: string[][] = [[]]
  for (const t of tokens) if (t === '&&') cmds.push([]); else cmds.at(-1)!.push(t)
  return cmds
}
/** Runs a printed command line: each part must start with `werk`. */
function runPrinted(p: Project, line: string, subst: Record<string, string> = {}) {
  for (let argv of parseCommand(line)) {
    expect(argv[0]).toBe('werk')
    argv = argv.slice(1).map((a) => subst[a] ?? a)
    const r = p.werk(argv)
    expect({ cmd: argv.join(' '), code: r.code, err: r.stderr }).toMatchObject({ code: 0 })
  }
}
/** The command lines in a refusal: indented lines that start with `werk `. */
const printedCommands = (out: string) => out.split('\n').filter((l) => /^\s+werk /.test(l)).map((l) => l.trim())

/** A real decided card with no parent: a basis target. */
function decidedBase(p: Project, id: string) {
  ok(p, ['add', id, '--title', `Base ${id}`, '--who', 'prototype'])
  ok(p, ['accept', id, '--actor', 'you'])
  ok(p, ['edit', id, '--no-basis', 'root of the map'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['status', id, 'decided'])
}

test('62.1 an agent proposes a card and a person accepts it', () => {
  const p = makeProject()
  ok(p, ['add', 'seed', '--title', 'Seed card'])
  ok(p, ['say', 'seed', '--text', 'a note'])
  expect(logLines(p).length).toBeGreaterThan(0)

  const add = appendsOne(p, ['add', 'log', '--title', 'Use a log', '--body', 'Keep every event.', '--why', 'Replay is easy'])
  expect(add.stdout).toContain('proposed')

  const s1 = show(p, 'log').stdout
  expect(s1).toContain('Use a log')
  expect(s1).toContain('Keep every event.')
  expect(s1).toContain('Replay is easy')
  expect(isGhost(s1)).toBe(true)

  appendsOne(p, ['accept', 'log', '--actor', 'you'])
  const s2 = show(p, 'log').stdout
  expect(s2).toContain('Use a log')
  expect(s2).toContain('Keep every event.')
  expect(s2).toContain('Replay is easy')
  expect(isReal(s2)).toBe(true)
  expect(isGhost(s2)).toBe(false)
})

test('62.2 an accept without the claim refuses and leaves the ghost waiting', () => {
  const p = makeProject()
  ok(p, ['add', 'a', '--title', 'Use a log'])
  refuses(p, ['accept', 'a'])
  expect(isGhost(show(p, 'a').stdout)).toBe(true)
  ok(p, ['accept', 'a', '--actor', 'you'])
  expect(isReal(show(p, 'a').stdout)).toBe(true)
})

test('62.3 the words of a ghost are frozen', () => {
  const p = makeProject()
  ok(p, ['add', 'a', '--title', 'Use a log'])
  refuses(p, ['edit', 'a', '--body', 'other body'])
  refuses(p, ['retitle', 'a', '--title', 'Use an append-only log'])
  refuses(p, ['add', 'a', '--title', 'A different title'])
  const s = show(p, 'a').stdout
  expect(s).toContain('#a  Use a log')
  expect(isGhost(s)).toBe(true)
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  const p = makeProject()
  ok(p, ['add', 'a', '--title', 'Use a log'])
  ok(p, ['accept', 'a', '--actor', 'you'])
  const before = logLines(p)
  appendsOne(p, ['retitle', 'a', '--title', 'Use an append-only log'])
  const s = show(p, 'a').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const firstLine = before.findIndex((l) => l.includes('"Use a log"'))
  expect(firstLine).toBeGreaterThanOrEqual(0)
  expect(logLines(p)[firstLine]).toContain('"Use a log"')
  ok(p, ['edit', 'a', '--body', 'Nothing is ever deleted.'])
  const s2 = show(p, 'a').stdout
  expect(s2).toContain('Nothing is ever deleted.')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  const p = makeProject()
  ok(p, ['add', 'c', '--title', 'Storage'])
  ok(p, ['accept', 'c', '--actor', 'you'])
  const opt = appendsOne(p, ['add', 'o', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy', '--parent', 'c'])
  const src = appendsOne(p, ['add', 's', '--kind', 'source', '--title', 'Benchmark notes', '--body', 'Numbers from a run'])
  const exc = appendsOne(p, ['add', 'e', '--kind', 'excerpt', '--title', 'A quoted line', '--body', 'We need it fast'])
  for (const r of [opt, src, exc]) expect(r.stdout).toContain('proposed')

  const so = show(p, 'o').stdout
  expect(so).toContain('Use Postgres')
  expect(so).toContain('why-not: Too heavy')
  expect(so).toContain('kind: option')
  expect(isGhost(so)).toBe(true)
  const ss = show(p, 's').stdout
  expect(ss).toContain('Benchmark notes')
  expect(ss).toContain('Numbers from a run')
  expect(isGhost(ss)).toBe(true)
  const se = show(p, 'e').stdout
  expect(se).toContain('A quoted line')
  expect(se).toContain('We need it fast')
  expect(isGhost(se)).toBe(true)

  ok(p, ['accept', 'o', '--actor', 'you'])
  const so2 = show(p, 'o').stdout
  expect(isReal(so2)).toBe(true)
  expect(so2).toContain('why-not: Too heavy')
  expect(isGhost(show(p, 's').stdout)).toBe(true)
  expect(isGhost(show(p, 'e').stdout)).toBe(true)
})

test('63.1 a link to a ghost is held and goes live on accept with no extra link event', () => {
  const p = makeProject()
  ok(p, ['add', 'storage', '--title', 'Storage'])
  ok(p, ['accept', 'storage', '--actor', 'you'])
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'sqlite', 'storage', '--type', 'depends_on'])
  expect(show(p, 'sqlite').stdout).toMatch(/^link: depends_on -> #storage \(held\)/m)
  const st = show(p, 'storage').stdout
  expect(st).not.toMatch(/^link: depends_on <- #sqlite(?! \(held\))/m)

  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s2 = show(p, 'sqlite').stdout
  expect(s2).toMatch(/^link: depends_on -> #storage$/m)
  const links = logLines(p).map((l) => JSON.parse(l)).filter(
    (e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
  )
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on', () => {
  const p = makeProject()
  ok(p, ['add', 'platform', '--title', 'Platform'])
  ok(p, ['accept', 'platform', '--actor', 'you'])
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic', 'email', '--type', 'depends_on'])
  ok(p, ['accept', 'magic', '--actor', 'you'])
  const m = show(p, 'magic').stdout
  expect(isReal(m)).toBe(true)
  const a = show(p, 'auth').stdout
  expect(isReal(a)).toBe(true)
  expect(a).toContain('parent: #platform')
  expect(isGhost(show(p, 'email').stdout)).toBe(true)
  expect(m).toMatch(/^link: depends_on -> #email \(held\)/m)
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  const p = makeProject()
  ok(p, ['add', 'storage', '--title', 'Storage', '--who', 'prototype'])
  ok(p, ['accept', 'storage', '--actor', 'you'])
  ok(p, ['edit', 'storage', '--no-basis', 'root'])
  ok(p, ['kill', 'storage', '--form', 'revisit'])
  ok(p, ['status', 'storage', 'decided'])
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'sqlite', 'bench', '--type', 'supported_by'])
  // A kill criterion is needed for any decide (contract); the step does not name it.
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  const who = p.werk(['edit', 'sqlite', '--who', 'you'])
  const st = p.werk(['status', 'sqlite', 'decided'])
  expect({ who: who.code, whoErr: who.stderr }).toEqual({ who: 0, whoErr: '' })
  expect({ st: st.code, stErr: st.stderr }).toEqual({ st: 0, stErr: '' })

  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s = show(p, 'sqlite').stdout
  expect(isReal(s)).toBe(true)
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const o = show(p, 'pg').stdout
  expect(isReal(o)).toBe(true)
  expect(o).toContain('kind: option')
  expect(o).toContain('why-not: Needs a server')
  const b = show(p, 'bench').stdout
  expect(isReal(b)).toBe(true)
  expect(b).toContain('kind: source')
  expect(b).toMatch(/^link: supported_by <- #sqlite$/m)
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  const p = makeProject()
  ok(p, ['add', 'platform', '--title', 'Platform'])
  ok(p, ['accept', 'platform', '--actor', 'you'])
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  for (const id of ['auth', 'magic', 'pw']) {
    const r = show(p, id)
    expect({ id, code: r.code }).toEqual({ id, code: 1 })
  }
  const find = p.werk(['find']).stdout
  for (const t of ['Auth', 'Magic links', 'Passwords']) expect(find).not.toContain(t)
  const pl = show(p, 'platform').stdout
  expect(isReal(pl)).toBe(true)
  for (const id of ['#auth', '#magic', '#pw']) expect(pl).not.toContain(id)
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  const p = makeProject()
  ok(p, ['add', 'storage', '--title', 'Storage', '--who', 'prototype'])
  ok(p, ['accept', 'storage', '--actor', 'you'])
  ok(p, ['edit', 'storage', '--no-basis', 'root'])
  ok(p, ['kill', 'storage', '--form', 'revisit'])
  ok(p, ['status', 'storage', 'decided'])
  ok(p, ['add', 'kid', '--title', 'Kid', '--parent', 'storage', '--who', 'you'])
  ok(p, ['accept', 'kid', '--actor', 'you'])
  ok(p, ['kill', 'kid', '--form', 'revisit'])
  ok(p, ['status', 'kid', 'decided', '--unchallenged'])

  const rollupOf = () => show(p, 'storage').stdout.match(/^rollup: .*$/m)?.[0]
  const before = rollupOf()
  expect(before).toBeDefined()
  const cards = (r?: string) => Number(r?.match(/rollup: (\d+) cards/)?.[1])
  const unch = (r?: string) => Number(r?.match(/(\d+) unchallenged/)?.[1])
  expect(p.werk(['stale']).stdout).not.toContain('#storage')

  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'you'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Server'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  ok(p, ['status', 'sqlite', 'decided'])

  const mid = rollupOf()
  expect(cards(mid)).toBe(cards(before))
  expect(unch(mid)).toBe(unch(before))
  expect(p.werk(['stale']).stdout).not.toContain('#storage')

  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  expect(cards(rollupOf())).toBe(cards(before) + 1)
})

test('64.1 a card without a kill criterion stays open, and the printed command fixes it', () => {
  const p = makeProject()
  decidedBase(p, 'base')
  ok(p, ['add', 'c', '--title', 'Use a log', '--who', 'you'])
  ok(p, ['accept', 'c', '--actor', 'you'])
  ok(p, ['link', 'c', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'o', '--kind', 'option', '--title', 'Use a table', '--why-not', 'Loses history'])
  ok(p, ['accept', 'o', '--actor', 'you'])
  ok(p, ['link', 'o', 'c', '--type', 'alternative_to'])

  const r = refuses(p, ['status', 'c', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill/)
  expect(out).not.toMatch(/^\s*(who|basis|options):/m)
  const cmds = printedCommands(out)
  const killCmd = cmds.find((c) => c.startsWith('werk kill c '))
  expect(killCmd).toBeDefined()
  expect(statusOf(p, 'c')).toBe('open')
  const statusEvents = logLines(p).map((l) => JSON.parse(l)).filter((e) => e.type === 'node.status_set' && e.payload.id === 'c')
  expect(statusEvents).toHaveLength(0)

  runPrinted(p, killCmd!)
  const r2 = p.werk(['status', 'c', 'decided'])
  expect(r2.code).toBe(0)
  expect(statusOf(p, 'c')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each with its own command', () => {
  const p = makeProject()
  decidedBase(p, 'base')
  ok(p, ['add', 'c', '--title', 'Use a log', '--body', 'Keep every event.'])
  ok(p, ['accept', 'c', '--actor', 'you'])
  const r = refuses(p, ['status', 'c', 'decided'])
  const out = r.stdout + r.stderr
  for (const fact of ['who', 'basis', 'options', 'kill']) expect(out).toMatch(new RegExp(`^\\s*${fact}:`, 'm'))
  expect(out).toContain('depends_on')
  const cmds = printedCommands(out)
  expect(cmds.length).toBeGreaterThanOrEqual(4)
  expect(cmds.some((c) => c.startsWith('werk edit c --who'))).toBe(true)
  expect(cmds.some((c) => c.includes('--type depends_on'))).toBe(true)
  expect(cmds.some((c) => c.includes('--kind option'))).toBe(true)
  expect(cmds.some((c) => c.startsWith('werk kill c'))).toBe(true)
  expect(statusOf(p, 'c')).toBe('open')

  for (const c of cmds) runPrinted(p, c, { '<card-it-needs>': 'base' })
  // The option command proposes a ghost option; the step leaves accept open, so it is not accepted here.
  ok(p, ['status', 'c', 'decided'])
  expect(statusOf(p, 'c')).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  const p = makeProject()
  decidedBase(p, 'base')
  ok(p, ['add', 'g1', '--title', 'Ghost one'])
  ok(p, ['edit', 'g1', '--who', 'you'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'o1', '--kind', 'option', '--title', 'Other way', '--why-not', 'Slow'])
  ok(p, ['link', 'o1', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'revisit'])
  ok(p, ['add', 'g2', '--title', 'Ghost two'])
  ok(p, ['edit', 'g2', '--who', 'you'])
  ok(p, ['add', 'o2', '--kind', 'option', '--title', 'Other way two', '--why-not', 'Slow'])
  ok(p, ['link', 'o2', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'revisit'])

  expect(p.werk(['status', 'g1', 'decided']).code).toBe(0)
  const s1 = show(p, 'g1').stdout
  expect(isGhost(s1)).toBe(true)
  expect(statusOf(p, 'g1')).toBe('decided')

  const r = refuses(p, ['status', 'g2', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s*basis:.*depends_on/m)
  expect(printedCommands(out).some((c) => c.startsWith('werk link g2') && c.includes('--type depends_on'))).toBe(true)
  expect(statusOf(p, 'g2')).not.toBe('decided')
})

function decidedCard(p: Project) {
  decidedBase(p, 'base')
  ok(p, ['add', 'c', '--title', 'Use a log', '--body', 'A long body about the log and why it helps.', '--who', 'you'])
  ok(p, ['accept', 'c', '--actor', 'you'])
  ok(p, ['link', 'c', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'o', '--kind', 'option', '--title', 'Use a table', '--why-not', 'Loses history'])
  ok(p, ['accept', 'o', '--actor', 'you'])
  ok(p, ['link', 'o', 'c', '--type', 'alternative_to'])
  ok(p, ['kill', 'c', '--form', 'revisit'])
  ok(p, ['status', 'c', 'decided'])
}

test('64.4 an amend that removes a required fact is refused and the card stays the same', () => {
  const p = makeProject()
  decidedCard(p)
  const before = show(p, 'c').stdout
  const r = refuses(p, ['amend', 'c', '--summary', 'drop the base', '--unlink', 'base'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s*basis:.*depends_on/m)
  expect(printedCommands(out).some((c) => c.startsWith('werk link c') && c.includes('--type depends_on'))).toBe(true)
  expect(statusOf(p, 'c')).toBe('decided')
  expect(show(p, 'c').stdout).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  const p = makeProject()
  decidedCard(p)
  const before = logLines(p).length
  const r = p.werk(['amend', 'c', '--summary', 'shorter body', '--body', 'Short.'])
  expect(r.code).toBe(0)
  const s = show(p, 'c').stdout
  expect(statusOf(p, 'c')).toBe('decided')
  expect(s).toContain('Short.')
  const added = logLines(p).slice(before).map((l) => JSON.parse(l))
  expect(added.some((e) => e.type === 'node.reopened' && e.payload.id === 'c')).toBe(true)
  expect(added.at(-1)).toMatchObject({ type: 'node.status_set', payload: { id: 'c', status: 'decided' } })
})
