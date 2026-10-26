/** Held-out steps 62.x, 63.x and 64.x: ghosts, accept, links, discard and the contract check, run as a process. */
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

let p: Project

const logLines = () => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}
const events = () => logLines().map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })

const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const show = (id: string) => p.werk(['show', id]).stdout

/** Runs a verb and checks that it appended exactly one line at the end and kept every earlier line. */
const appendsOne = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).toBe(0)
  const after = logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
/** Runs a verb, checks that it exits with a failure and that the log has no new event. */
const refuses = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(logLines()).toEqual(before)
  return r
}
const printedCommands = (text: string) =>
  text
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())
const runPrinted = (line: string, fill: Record<string, string> = {}) => {
  let l = line
  for (const [k, v] of Object.entries(fill)) l = l.replaceAll(k, v)
  for (const command of l.split(' && ')) {
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    ok(words.slice(1))
  }
}

// ---------- 62 ----------

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  p = makeProject()
  ok(['add', 'seed', '--title', 'Seed'])
  ok(['say', 'seed', '--text', 'an earlier event'])
  expect(logLines().length).toBeGreaterThan(0)

  const add = appendsOne(['add', 'use-log', '--title', 'Use a log', '--body', 'Every change is an event.', '--why', 'History stays.'])
  expect(add.stdout).toContain('proposed')

  const ghost = p.werk(['show', 'use-log'])
  expect(ghost.stdout).toContain('Use a log')
  expect(ghost.stdout).toContain('Every change is an event.')
  expect(ghost.stdout).toContain('History stays.')
  expect(ghost.stdout).toContain('ghost')

  appendsOne(['accept', 'use-log', '--actor', 'you'])
  const real = show('use-log')
  expect(real).toContain('Use a log')
  expect(real).toContain('Every change is an event.')
  expect(real).toContain('History stays.')
  expect(real).toContain('state: real')
  expect(real).not.toContain('ghost')
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  p = makeProject()
  ok(['add', 'a', '--title', 'A card'])
  refuses(['accept', 'a'])
  expect(show('a')).toContain('ghost')
  ok(['accept', 'a', '--actor', 'you'])
  expect(show('a')).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(['add', 'a', '--title', 'Use a log'])
  refuses(['edit', 'a', '--body', 'New body'])
  refuses(['retitle', 'a', '--title', 'Use an append-only log'])
  refuses(['add', 'a', '--title', 'Another title'])
  const s = show('a')
  expect(s).toContain('Use a log')
  expect(s).toContain('ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(['add', 'a', '--title', 'Use a log'])
  ok(['accept', 'a', '--actor', 'you'])
  const before = logLines()
  appendsOne(['retitle', 'a', '--title', 'Use an append-only log'])
  const s = show('a')
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true)
  expect(logLines().slice(0, before.length)).toEqual(before)
  ok(['edit', 'a', '--body', 'Nothing is deleted.'])
  const s2 = show('a')
  expect(s2).toContain('Nothing is deleted.')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  ok(['add', 'card', '--title', 'Real card'])
  ok(['accept', 'card', '--actor', 'you'])

  const opt = appendsOne(['add', 'opt', '--kind', 'option', '--title', 'Use a table', '--why-not', 'it loses history', '--parent', 'card'])
  expect(opt.stdout).toContain('proposed')
  const src = appendsOne(['add', 'src', '--kind', 'source', '--title', 'Event sourcing notes', '--body', 'notes body'])
  expect(src.stdout).toContain('proposed')
  const exc = appendsOne(['add', 'exc', '--kind', 'excerpt', '--title', 'A quote', '--body', 'quoted words'])
  expect(exc.stdout).toContain('proposed')

  const so = show('opt')
  expect(so).toContain('Use a table')
  expect(so).toContain('it loses history')
  expect(so).toContain('ghost')
  expect(show('src')).toContain('Event sourcing notes')
  expect(show('src')).toContain('ghost')
  expect(show('exc')).toContain('A quote')
  expect(show('exc')).toContain('ghost')

  ok(['accept', 'opt', '--actor', 'you'])
  const so2 = show('opt')
  expect(so2).toContain('state: real')
  expect(so2).toContain('why-not: it loses history')
  expect(show('src')).toContain('ghost')
  expect(show('exc')).toContain('ghost')
})

// ---------- 63 ----------

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = makeProject()
  ok(['add', 'storage', '--title', 'Storage'])
  ok(['accept', 'storage', '--actor', 'you'])
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'use-sqlite', 'storage', '--type', 'depends_on', '--why', 'basis'])
  expect(show('use-sqlite')).toMatch(/depends_on -> #storage \(held\)/)
  expect(show('storage')).not.toMatch(/depends_on <- #use-sqlite(?! \(held\))/)
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const s = show('use-sqlite')
  expect(s).toContain('depends_on -> #storage')
  expect(s).not.toMatch(/depends_on -> #storage \(held\)/)
  const links = events().filter((e) => e.type === 'edge.linked' && e.payload.type === 'depends_on' && e.payload.from === 'use-sqlite')
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = makeProject()
  ok(['add', 'platform', '--title', 'Platform'])
  ok(['accept', 'platform', '--actor', 'you'])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic-links', 'email-service', '--type', 'depends_on'])
  ok(['accept', 'magic-links', '--actor', 'you'])
  expect(show('magic-links')).toContain('state: real')
  const auth = show('auth')
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(show('email-service')).toContain('ghost')
  expect(show('magic-links')).toContain('depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = makeProject()
  ok(['add', 'storage', '--title', 'Storage', '--who', 'me'])
  ok(['accept', 'storage', '--actor', 'you'])
  ok(['edit', 'storage', '--no-basis', 'the root'])
  ok(['kill', 'storage', '--form', 'revisit'])
  ok(['status', 'storage', 'decided'])
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'a server to run'])
  ok(['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
  ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'use-sqlite', 'bench', '--type', 'supported_by'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'me'])
  ok(['kill', 'use-sqlite', '--form', 'revisit'])
  const status = p.werk(['status', 'use-sqlite', 'decided'])
  ok(['accept', 'use-sqlite', '--actor', 'you'])

  const s = show('use-sqlite')
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: me')
  const o = show('use-postgres')
  expect(o).toContain('state: real')
  expect(o).toContain('why-not: a server to run')
  expect(show('bench')).toContain('state: real')
  expect(s).toContain('supported-by: #bench')
  expect(s).not.toMatch(/bench.*\(held\)/)
  expect(who.code).toBe(0)
  expect(status.code).toBe(0)
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = makeProject()
  ok(['add', 'platform', '--title', 'Platform'])
  ok(['accept', 'platform', '--actor', 'you'])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'passwords', '--kind', 'option', '--title', 'Passwords', '--why-not', 'leaks'])
  ok(['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
  ok(['discard', 'auth'])
  for (const id of ['auth', 'magic-links', 'passwords']) {
    const r = p.werk(['show', id])
    expect(r.code).not.toBe(0)
    expect(r.stdout).not.toContain('state:')
  }
  const s = show('platform')
  expect(s).toContain('state: real')
  expect(s).not.toContain('auth')
  expect(s).not.toContain('(held)')
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  ok(['add', 'storage', '--title', 'Storage', '--who', 'me'])
  ok(['accept', 'storage', '--actor', 'you'])
  ok(['edit', 'storage', '--no-basis', 'the root'])
  ok(['kill', 'storage', '--form', 'revisit'])
  ok(['status', 'storage', 'decided'])
  ok(['add', 'files', '--title', 'Files', '--parent', 'storage', '--who', 'me'])
  ok(['accept', 'files', '--actor', 'you'])
  ok(['kill', 'files', '--form', 'revisit'])
  ok(['add', 'files:opt', '--kind', 'option', '--title', 'Blobs', '--why-not', 'cost'])
  ok(['link', 'files:opt', 'files', '--type', 'alternative_to'])
  ok(['accept', 'files:opt', '--actor', 'you'])
  ok(['status', 'files', 'decided'])

  const rollupOf = () => show('storage').split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(before).toContain('unchallenged')
  const staleBefore = p.werk(['stale']).stdout
  expect(staleBefore).not.toContain('#storage')

  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(['kill', 'use-sqlite', '--form', 'revisit'])
  ok(['add', 'use-sqlite:opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'a server'])
  ok(['link', 'use-sqlite:opt', 'use-sqlite', '--type', 'alternative_to'])
  ok(['status', 'use-sqlite', 'decided'])
  expect(show('use-sqlite')).toContain('status: decided')

  expect(rollupOf()).toBe(before)
  expect(p.werk(['stale']).stdout).not.toContain('#storage')

  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const after = rollupOf()!
  expect(after).not.toBe(before)
  expect(Number(after.match(/rollup: (\d+) cards/)![1])).toBe(Number(before!.match(/rollup: (\d+) cards/)![1]) + 1)
})

// ---------- 64 ----------

const decidedBase = () => {
  ok(['add', 'base', '--title', 'Base', '--who', 'me'])
  ok(['accept', 'base', '--actor', 'you'])
  ok(['edit', 'base', '--no-basis', 'the root of the map'])
  ok(['kill', 'base', '--form', 'revisit'])
  ok(['status', 'base', 'decided'])
}
const statusEvents = (id: string) => events().filter((e) => e.payload.id === id && (e.type === 'node.status_set' || e.type === 'node.reopened'))

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = makeProject()
  decidedBase()
  ok(['add', 'a', '--title', 'A', '--who', 'me', '--body', 'Body'])
  ok(['accept', 'a', '--actor', 'you'])
  ok(['link', 'a', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(['add', 'a:opt0', '--kind', 'option', '--title', 'Other way', '--why-not', 'costs more'])
  ok(['link', 'a:opt0', 'a', '--type', 'alternative_to'])
  ok(['accept', 'a:opt0', '--actor', 'you'])
  const before = statusEvents('a')

  const r = refuses(['status', 'a', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill criterion/)
  const cmds = printedCommands(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]).toMatch(/^werk kill a /)
  expect(show('a')).toContain('status: open')
  expect(statusEvents('a')).toEqual(before)

  runPrinted(cmds[0]!)
  ok(['status', 'a', 'decided'])
  expect(show('a')).toContain('status: decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = makeProject()
  decidedBase()
  ok(['add', 'a', '--title', 'A', '--body', 'Some body text.'])
  ok(['accept', 'a', '--actor', 'you'])
  const r = refuses(['status', 'a', 'decided'])
  const out = r.stdout + r.stderr
  for (const fact of ['who', 'basis', 'options', 'kill']) expect(out).toContain(`${fact}: `)
  expect(out).toMatch(/depends_on/)
  const cmds = printedCommands(out)
  expect(cmds.length).toBeGreaterThanOrEqual(4)
  expect(show('a')).toContain('status: open')
  for (const c of cmds) runPrinted(c, { '<card-it-needs>': 'base' })
  ok(['status', 'a', 'decided'])
  expect(show('a')).toContain('status: decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = makeProject()
  decidedBase()
  ok(['add', 'g1', '--title', 'G1', '--who', 'me'])
  ok(['link', 'g1', 'base', '--type', 'depends_on', '--why', 'takes base'])
  ok(['add', 'g1:opt', '--kind', 'option', '--title', 'Other', '--why-not', 'slow'])
  ok(['link', 'g1:opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'manual', '--text', 'use it for a week'])

  ok(['add', 'g2', '--title', 'G2', '--who', 'me'])
  ok(['add', 'g2:opt', '--kind', 'option', '--title', 'Other', '--why-not', 'slow'])
  ok(['link', 'g2:opt', 'g2', '--type', 'alternative_to'])
  ok(['kill', 'g2', '--form', 'revisit'])

  expect(show('g1')).toContain('(held)')
  const r1 = p.werk(['status', 'g1', 'decided'])
  expect(r1.code).toBe(0)
  expect(show('g1')).toContain('status: decided')
  expect(show('g1')).toContain('ghost')

  const r2 = refuses(['status', 'g2', 'decided'])
  const out = r2.stdout + r2.stderr
  expect(out).toContain('basis: ')
  expect(printedCommands(out).some((c) => c.includes('--type depends_on'))).toBe(true)
  expect(show('g2')).not.toContain('status: decided')
})

const weighedDecided = () => {
  decidedBase()
  ok(['add', 'a', '--title', 'A', '--who', 'me', '--body', 'Old words.'])
  ok(['accept', 'a', '--actor', 'you'])
  ok(['link', 'a', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(['add', 'a:opt0', '--kind', 'option', '--title', 'Another way', '--why-not', 'it costs more'])
  ok(['link', 'a:opt0', 'a', '--type', 'alternative_to'])
  ok(['accept', 'a:opt0', '--actor', 'you'])
  ok(['kill', 'a', '--form', 'revisit'])
  ok(['status', 'a', 'decided'])
}

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = makeProject()
  weighedDecided()
  const before = show('a')
  const r = refuses(['amend', 'a', '--unlink', 'base', '--summary', 'a no longer takes the base'])
  const out = r.stdout + r.stderr
  expect(out).toContain('basis: ')
  expect(printedCommands(out).some((c) => c.includes('--type depends_on'))).toBe(true)
  const after = show('a')
  expect(after).toContain('status: decided')
  expect(after).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = makeProject()
  weighedDecided()
  const n = statusEvents('a').length
  ok(['amend', 'a', '--body', 'Short.', '--summary', 'shorter'])
  const s = show('a')
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  expect(statusEvents('a').slice(n).map((e) => e.type)).toEqual(['node.reopened', 'node.status_set'])
})
