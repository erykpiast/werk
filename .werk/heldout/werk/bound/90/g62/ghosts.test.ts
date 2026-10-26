/** Held-out steps 62.1–62.5 and 63.1–63.5: ghosts, accept, held links, discard. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

let p: Project
afterEach(() => p?.cleanup())

const logPath = () => join(p.dir, '.werk', 'log.jsonl')
const logLines = () => (existsSync(logPath()) ? readFileSync(logPath(), 'utf8').split('\n').filter(Boolean) : [])
const events = () => logLines().map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })

const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const appendsOne = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).toBe(0)
  const after = logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
const refuses = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(logLines()).toEqual(before)
  return r
}
const show = (id: string) => p.werk(['show', id])
const isGhost = (id: string) => show(id).stdout.includes('state: ghost')
const isReal = (id: string) => show(id).stdout.includes('state: real')

/** A real, decided root card: decider me, no basis needed, one kill criterion. */
const decidedRoot = (id: string, title: string) => {
  ok(['add', id, '--title', title, '--who', 'me'])
  ok(['accept', id, '--actor', 'you'])
  ok(['edit', id, '--no-basis', 'the root of the map'])
  ok(['kill', id, '--form', 'manual', '--text', `revisit ${id}`])
  ok(['status', id, 'decided'])
}
const rollupLine = (id: string) => show(id).stdout.split('\n').find((l) => l.startsWith('rollup:'))

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  p = makeProject()
  ok(['add', 'pre1', '--title', 'Earlier card'])
  ok(['accept', 'pre1', '--actor', 'you'])
  const add = appendsOne(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.stdout).toContain('proposed')
  const g = show('c1').stdout
  expect(g).toContain('Use a log')
  expect(g).toContain('The body text')
  expect(g).toContain('The why text')
  expect(g).toContain('state: ghost')
  appendsOne(['accept', 'c1', '--actor', 'you'])
  const r = show('c1').stdout
  expect(r).toContain('Use a log')
  expect(r).toContain('The body text')
  expect(r).toContain('The why text')
  expect(r).toContain('state: real')
  expect(r).not.toContain('ghost')
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  refuses(['accept', 'c1'])
  expect(isGhost('c1')).toBe(true)
  ok(['accept', 'c1', '--actor', 'you'])
  expect(isReal('c1')).toBe(true)
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  refuses(['edit', 'c1', '--body', 'new body'])
  refuses(['retitle', 'c1', '--title', 'Use an append-only log'])
  refuses(['add', 'c1', '--title', 'Another title'])
  const s = show('c1').stdout
  expect(s).toContain('Use a log')
  expect(s).toContain('state: ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  ok(['accept', 'c1', '--actor', 'you'])
  appendsOne(['retitle', 'c1', '--title', 'Use an append-only log'])
  const s = show('c1').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const lines = logLines()
  expect(lines.slice(0, -1).some((l) => l.includes('"Use a log"'))).toBe(true)
  ok(['edit', 'c1', '--body', 'Nothing is ever deleted.'])
  const s2 = show('c1').stdout
  expect(s2).toContain('Nothing is ever deleted.')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  ok(['accept', 'c1', '--actor', 'you'])
  for (const args of [
    ['add', 'o1', '--kind', 'option', '--title', 'Use a database', '--why-not', 'too heavy', '--parent', 'c1'],
    ['add', 's1', '--kind', 'source', '--title', 'A paper on logs'],
    ['add', 'e1', '--kind', 'excerpt', '--title', 'Logs never forget'],
  ]) {
    expect(appendsOne(args).stdout).toContain('proposed')
  }
  const o = show('o1').stdout
  expect(o).toContain('Use a database')
  expect(o).toContain('why-not: too heavy')
  expect(o).toContain('kind: option')
  expect(o).toContain('state: ghost')
  expect(show('s1').stdout).toContain('A paper on logs')
  expect(show('s1').stdout).toContain('kind: source')
  expect(isGhost('s1')).toBe(true)
  expect(show('e1').stdout).toContain('Logs never forget')
  expect(show('e1').stdout).toContain('kind: excerpt')
  expect(isGhost('e1')).toBe(true)
  ok(['accept', 'o1', '--actor', 'you'])
  expect(isReal('o1')).toBe(true)
  expect(show('o1').stdout).toContain('why-not: too heavy')
  expect(isGhost('s1')).toBe(true)
  expect(isGhost('e1')).toBe(true)
})

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = makeProject()
  ok(['add', 'storage', '--title', 'Storage'])
  ok(['accept', 'storage', '--actor', 'you'])
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'sqlite', 'storage', '--type', 'depends_on'])
  expect(show('sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const liveOfStorage = show('storage').stdout.split('\n').filter((l) => l.startsWith('link: depends_on <- #sqlite') && !l.includes('(held)'))
  expect(liveOfStorage).toHaveLength(0)
  ok(['accept', 'sqlite', '--actor', 'you'])
  const s = show('sqlite').stdout.split('\n')
  expect(s.some((l) => l.startsWith('link: depends_on -> #storage') && !l.includes('(held)'))).toBe(true)
  const links = events().filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = makeProject()
  ok(['add', 'platform', '--title', 'Platform'])
  ok(['accept', 'platform', '--actor', 'you'])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic', 'email', '--type', 'depends_on'])
  ok(['accept', 'magic', '--actor', 'you'])
  expect(isReal('magic')).toBe(true)
  expect(isReal('auth')).toBe(true)
  expect(show('auth').stdout).toContain('parent: #platform')
  expect(isGhost('email')).toBe(true)
  expect(show('magic').stdout).toContain('link: depends_on -> #email (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = makeProject()
  decidedRoot('storage', 'Storage')
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
  ok(['link', 'postgres', 'sqlite', '--type', 'alternative_to'])
  ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'sqlite', 'bench', '--type', 'supported_by'])
  // Setup: the fourth contract fact, so a decide can go through.
  ok(['kill', 'sqlite', '--form', 'manual', '--text', 'revisit after a month'])
  const who = p.werk(['edit', 'sqlite', '--who', 'you'])
  const status = p.werk(['status', 'sqlite', 'decided'])
  ok(['accept', 'sqlite', '--actor', 'you'])
  const s = show('sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const o = show('postgres').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('kind: option')
  expect(o).toContain('why-not: needs a server')
  const b = show('bench').stdout
  expect(b).toContain('state: real')
  expect(b.split('\n').some((l) => l.startsWith('link: supported_by <- #sqlite') && !l.includes('(held)'))).toBe(true)
  expect({ who: who.code, status: status.code, whyErr: who.stderr + status.stderr }).toEqual({ who: 0, status: 0, whyErr: '' })
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = makeProject()
  ok(['add', 'platform', '--title', 'Platform'])
  ok(['accept', 'platform', '--actor', 'you'])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(['link', 'passwords', 'magic', '--type', 'alternative_to'])
  ok(['discard', 'auth'])
  for (const id of ['auth', 'magic', 'passwords']) expect(show(id).code).not.toBe(0)
  const pl = show('platform').stdout
  expect(pl).toContain('state: real')
  expect(pl).not.toMatch(/#(auth|magic|passwords)/)
  const found = p.werk(['find', 'platform']).stdout
  expect(found).not.toMatch(/auth|magic|Passwords|Magic links/)
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  decidedRoot('storage', 'Storage')
  ok(['add', 'cache', '--title', 'Cache', '--parent', 'storage', '--who', 'me'])
  ok(['accept', 'cache', '--actor', 'you'])
  ok(['kill', 'cache', '--form', 'manual', '--text', 'revisit cache'])
  ok(['status', 'cache', 'decided'])
  const before = rollupLine('storage')
  expect(before).toBeDefined()
  const staleBefore = p.werk(['stale']).stdout
  expect(staleBefore).not.toContain('storage')

  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'you'])
  ok(['add', 'sqlite-opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'a server'])
  ok(['link', 'sqlite-opt', 'sqlite', '--type', 'alternative_to'])
  ok(['kill', 'sqlite', '--form', 'manual', '--text', 'revisit sqlite'])
  ok(['status', 'sqlite', 'decided'])
  expect(show('sqlite').stdout).toContain('state: ghost')
  expect(show('sqlite').stdout).toContain('status: decided')

  expect(rollupLine('storage')).toBe(before)
  expect(p.werk(['stale']).stdout).not.toContain('storage')

  ok(['accept', 'sqlite', '--actor', 'you'])
  const after = rollupLine('storage')!
  const cards = (l: string) => Number(/rollup: (\d+) cards/.exec(l)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
  expect(after).toMatch(/3 decided/)
})
