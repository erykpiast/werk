import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { graphOf } from '../src/map/graph.ts'
import { readLog } from '../src/map/log.ts'

let p: Project
afterEach(() => p?.cleanup())

const logFile = () => join(p.dir, '.werk', 'log.jsonl')
const lines = () => (existsSync(logFile()) ? readFileSync(logFile(), 'utf8').split('\n').filter(Boolean) : [])
const graph = () => graphOf(readLog(logFile()))

function ok(args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} failed (${r.code}): ${r.stderr}${r.stdout}`)
  return r
}
const show = (id: string) => p.werk(['show', id]).stdout

/** Checks that the log grew by exactly one line at the end and earlier lines are unchanged. */
function expectOneMore(before: string[]) {
  const after = lines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

/** A real card made by add then accept. */
function realCard(id: string, title: string, extra: string[] = []) {
  ok(['add', id, '--title', title, ...extra])
  ok(['accept', id, '--actor', 'you'])
}

test('62.1 An agent proposes a card and a person accepts it into the map', () => {
  p = makeProject()
  realCard('base', 'Base')
  ok(['say', 'base', '--text', 'a note'])
  const before = lines()
  expect(before.length).toBeGreaterThan(0)

  const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  expectOneMore(before)

  let s = show('use-log')
  expect(s).toContain('Use a log')
  expect(s).toContain('The body text')
  expect(s).toContain('The why text')
  expect(s).toContain('ghost')

  const mid = lines()
  const acc = p.werk(['accept', 'use-log', '--actor', 'you'])
  expect(acc.code).toBe(0)
  expectOneMore(mid)
  s = show('use-log')
  expect(s).toContain('Use a log')
  expect(s).toContain('The body text')
  expect(s).toContain('The why text')
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
})

test('62.2 An accept without the person\'s claim refuses and leaves the ghost waiting', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Card'])
  const before = lines()
  const r = p.werk(['accept', 'c'])
  expect(r.code).not.toBe(0)
  expect(lines()).toEqual(before)
  expect(show('c')).toContain('ghost')
  ok(['accept', 'c', '--actor', 'you'])
  expect(show('c')).toContain('state: real')
})

test('62.3 The words of a ghost are frozen', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Use a log'])
  const before = lines()
  let r = p.werk(['edit', 'c', '--body', 'new body'])
  expect(r.code).not.toBe(0)
  expect(lines()).toEqual(before)
  r = p.werk(['retitle', 'c', '--title', 'Use an append-only log'])
  expect(r.code).not.toBe(0)
  expect(lines()).toEqual(before)
  r = p.werk(['add', 'c', '--title', 'Something else'])
  expect(r.code).not.toBe(0)
  expect(lines()).toEqual(before)
  const s = show('c')
  expect(s).toContain('Use a log')
  expect(s).toContain('ghost')
})

test('62.4 A retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Use a log'])
  ok(['accept', 'c', '--actor', 'you'])
  const before = lines()
  const r = p.werk(['retitle', 'c', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  expectOneMore(before)
  let s = show('c')
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const earlier = before.find((l) => l.includes('"node.proposed"'))
  expect(earlier).toContain('Use a log')
  expect(lines()[before.indexOf(earlier!)]).toBe(earlier!)
  ok(['edit', 'c', '--body', 'A brand new body'])
  s = show('c')
  expect(s).toContain('A brand new body')
  expect(s).toContain('Use an append-only log')
})

test('62.5 An option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  realCard('c', 'Card')
  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'Too slow', '--parent', 'c']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'A paper', '--body', 'Source body']],
    ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'A quote', '--body', 'Excerpt body']],
  ]
  for (const [, args] of adds) {
    const before = lines()
    const r = p.werk(args)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    expectOneMore(before)
  }
  let s = show('opt')
  expect(s).toContain('Other way')
  expect(s).toContain('why-not: Too slow')
  expect(s).toContain('kind: option')
  expect(s).toContain('ghost')
  s = show('src')
  expect(s).toContain('A paper')
  expect(s).toContain('Source body')
  expect(s).toContain('kind: source')
  expect(s).toContain('ghost')
  s = show('exc')
  expect(s).toContain('A quote')
  expect(s).toContain('Excerpt body')
  expect(s).toContain('kind: excerpt')
  expect(s).toContain('ghost')

  ok(['accept', 'opt', '--actor', 'you'])
  s = show('opt')
  expect(s).toContain('state: real')
  expect(s).toContain('why-not: Too slow')
  expect(show('src')).toContain('ghost')
  expect(show('exc')).toContain('ghost')
})

test('63.1 A link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'use-sqlite', 'storage', '--type', 'depends_on'])
  expect(show('use-sqlite')).toContain('link: depends_on -> #storage (held)')
  const isEdge = (e: { from: string; to: string; type: string }) => e.from === 'use-sqlite' && e.to === 'storage' && e.type === 'depends_on'
  expect(graph().edges.some(isEdge)).toBe(false)
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const s = show('use-sqlite')
  expect(s).toContain('link: depends_on -> #storage')
  expect(s).not.toContain('(held)')
  const linkEvents = readLog(logFile()).filter(
    (e) => e.type === 'edge.linked' && isEdge(e.payload as { from: string; to: string; type: string }),
  )
  expect(linkEvents.length).toBe(1)
})

test('63.2 Accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic', 'email', '--type', 'depends_on'])
  ok(['accept', 'magic', '--actor', 'you'])
  expect(show('magic')).toContain('state: real')
  const a = show('auth')
  expect(a).toContain('state: real')
  expect(a).toContain('parent: #platform')
  expect(show('email')).toContain('ghost')
  expect(show('magic')).toContain('link: depends_on -> #email (held)')
})

test('63.3 An accept takes the card\'s own ghost options and sources with it', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy'])
  ok(['link', 'pg', 'use-sqlite', '--type', 'alternative_to'])
  ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'use-sqlite', 'bench', '--type', 'supported_by'])
  // Extra contract facts (the parent Storage is not decided, and a kill criterion is required).
  ok(['edit', 'use-sqlite', '--no-basis', 'Storage is the area, not a decision'])
  ok(['kill', 'use-sqlite', '--form', 'manual', '--text', 'Revisit if writes get slow'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'you'])
  const status = p.werk(['status', 'use-sqlite', 'decided'])
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const s = show('use-sqlite')
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const o = show('pg')
  expect(o).toContain('state: real')
  expect(o).toContain('kind: option')
  expect(o).toContain('why-not: Too heavy')
  const b = show('bench')
  expect(b).toContain('state: real')
  expect(b).toContain('kind: source')
  expect(s).toContain('supported-by: #bench')
  expect(graph().edges.some((e) => e.from === 'use-sqlite' && e.to === 'bench' && e.type === 'supported_by')).toBe(true)
  expect(who.code).toBe(0)
  expect(status.code).toBe(0)
})

test('63.4 Discarding a ghost parent discards its whole ghost branch', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(['discard', 'auth'])
  const ids = graph().nodes.map((n) => n.id)
  for (const id of ['auth', 'magic', 'pw']) {
    expect(ids).not.toContain(id)
    const r = p.werk(['show', id])
    expect(r.code).not.toBe(0)
  }
  const s = show('platform')
  expect(s).toContain('state: real')
  const g = graph()
  const kids = [...g.edges, ...g.ghostEdges].filter((e) => e.type === 'refines' && e.to === 'platform')
  expect(kids.length).toBe(0)
})

test('63.5 A ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  realCard('child', 'Child', ['--parent', 'storage'])
  ok(['edit', 'child', '--who', 'you', '--no-basis', 'Storage is the area'])
  ok(['kill', 'child', '--form', 'manual', '--text', 'Revisit by use'])
  ok(['status', 'child', 'decided', '--unchallenged'])
  const rollupLine = () => show('storage').split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupLine()
  expect(before).toBeDefined()
  const staleBefore = p.werk(['stale']).stdout
  expect(staleBefore).not.toContain('#storage')
  expect(graph().marks.storage).toBeUndefined()

  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy'])
  ok(['link', 'pg', 'use-sqlite', '--type', 'alternative_to'])
  ok(['edit', 'use-sqlite', '--who', 'you', '--no-basis', 'Storage is the area'])
  ok(['kill', 'use-sqlite', '--form', 'manual', '--text', 'Revisit by use'])
  ok(['status', 'use-sqlite', 'decided'])
  expect(rollupLine()).toBe(before)
  expect(p.werk(['stale']).stdout).not.toContain('#storage')
  expect(graph().marks.storage).toBeUndefined()

  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const after = rollupLine()
  expect(after).toContain('3 cards')
  expect(after).toContain('2 decided')
})
