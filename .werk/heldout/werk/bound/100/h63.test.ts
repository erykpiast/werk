import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import { makeProject, type Project } from '../src/test/harness.ts'

// Each step runs many werk commands, and a busy machine runs them slowly.
setDefaultTimeout(120_000)

const logPathOf = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const events = (p: Project) => (existsSync(logPathOf(p)) ? readLog(logPathOf(p)) : [])
const mapOf = (p: Project) => fold(events(p))
const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}
const show = (p: Project, id: string) => p.werk(['show', id])
const GHOST = 'state: ghost'
const REAL = 'state: real'

/** A real decided card with no basis need, so it can be a parent basis. */
function realDecided(p: Project, id: string, title: string) {
  ok(p, ['add', id, '--title', title, '--who', 'me'])
  ok(p, ['accept', id, '--actor', 'you'])
  ok(p, ['edit', id, '--no-basis', 'the root of the project'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['status', id, 'decided'])
}

// Scenario: A link to a ghost is held, and it goes live on accept with no extra link event
test('63.1 a link to a ghost is held, and goes live on accept', () => {
  const p = makeProject()
  ok(p, ['add', 'storage', '--title', 'Storage'])
  ok(p, ['accept', 'storage', '--actor', 'you'])
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'sqlite', 'storage', '--type', 'depends_on', '--why', 'basis'])
  const s1 = show(p, 'sqlite').stdout
  expect(s1).toContain('link: depends_on -> #storage (held)')
  const live = mapOf(p).edges.filter((e) => (e.from === 'storage' || e.to === 'storage') && e.type === 'depends_on')
  expect(live.length).toBe(0)
  expect(show(p, 'storage').stdout.split('\n').filter((l) => l.includes('depends_on <- #sqlite') && !l.includes('(held)'))).toEqual([])
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s2 = show(p, 'sqlite').stdout
  expect(s2).toContain('link: depends_on -> #storage')
  expect(s2).not.toContain('link: depends_on -> #storage (held)')
  const links = events(p).filter(
    (e) => e.type === 'edge.linked' && (e.payload as { from: string; to: string; type: string }).from === 'sqlite' && (e.payload as { to: string }).to === 'storage' && (e.payload as { type: string }).type === 'depends_on',
  )
  expect(links.length).toBe(1)
})

// Scenario: Accepting a ghost child also accepts its ghost parent, but not a ghost it depends on
test('63.2 accepting a ghost child accepts its ghost parent, not a dependency', () => {
  const p = makeProject()
  ok(p, ['add', 'platform', '--title', 'Platform'])
  ok(p, ['accept', 'platform', '--actor', 'you'])
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic', 'email', '--type', 'depends_on'])
  ok(p, ['accept', 'magic', '--actor', 'you'])
  expect(show(p, 'magic').stdout).toContain(REAL)
  const a = show(p, 'auth').stdout
  expect(a).toContain(REAL)
  expect(a).toContain('parent: #platform')
  expect(show(p, 'email').stdout).toContain(GHOST)
  expect(show(p, 'magic').stdout).toContain('link: depends_on -> #email (held)')
})

// Scenario: An accept takes the card's own ghost options and sources with it
test("63.3 an accept takes the card's own ghost options and sources", () => {
  const p = makeProject()
  realDecided(p, 'storage', 'Storage')
  const refusals: string[] = []
  const agent = (args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) refusals.push(`${args.join(' ')}: ${r.stderr}`)
    return r
  }
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'])
  ok(p, ['link', 'postgres', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'sqlite', 'bench', '--type', 'supported_by'])
  // Setup beyond the step text: the contract needs a kill criterion for a decide.
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  agent(['edit', 'sqlite', '--who', 'me'])
  agent(['status', 'sqlite', 'decided'])
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s = show(p, 'sqlite').stdout
  expect(s).toContain(REAL)
  expect(s).toContain('status: decided')
  expect(s).toContain('who: me')
  const o = show(p, 'postgres').stdout
  expect(o).toContain(REAL)
  expect(o).toContain('why-not: Needs a server')
  expect(show(p, 'bench').stdout).toContain(REAL)
  const m = mapOf(p)
  expect(m.edges.some((e) => e.from === 'sqlite' && e.to === 'bench' && e.type === 'supported_by')).toBe(true)
  expect(refusals).toEqual([])
})

// Scenario: Discarding a ghost parent discards its whole ghost branch
test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  const p = makeProject()
  ok(p, ['add', 'platform', '--title', 'Platform'])
  ok(p, ['accept', 'platform', '--actor', 'you'])
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'passwords', 'magic', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  const m = mapOf(p)
  for (const id of ['auth', 'magic', 'passwords']) {
    expect(m.nodes.has(id)).toBe(false)
    expect(show(p, id).code).not.toBe(0)
  }
  const pl = show(p, 'platform').stdout
  expect(pl).toContain(REAL)
  const ghostChildren = [...m.edges, ...m.ghostEdges].filter((e) => e.type === 'refines' && e.to === 'platform')
  expect(ghostChildren).toEqual([])
})

// Scenario: A ghost changes no count of a real card until it is accepted
test('63.5 a ghost changes no count of a real card until accepted', () => {
  const p = makeProject()
  realDecided(p, 'storage', 'Storage')
  ok(p, ['add', 'child', '--title', 'Child', '--parent', 'storage', '--who', 'you'])
  ok(p, ['accept', 'child', '--actor', 'you'])
  ok(p, ['kill', 'child', '--form', 'revisit'])
  ok(p, ['status', 'child', 'decided', '--unchallenged'])
  const rollupOf = () => show(p, 'storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(before).toMatch(/1 unchallenged/)
  expect(p.werk(['stale']).stdout).not.toContain('storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'heavy'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['status', 'sqlite', 'decided'])
  expect(rollupOf()).toBe(before)
  expect(p.werk(['stale']).stdout).not.toContain('storage')
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const after = rollupOf()!
  expect(after).toMatch(/rollup: 3 cards/)
})
