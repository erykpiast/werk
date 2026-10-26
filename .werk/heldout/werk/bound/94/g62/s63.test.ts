import { afterEach, beforeEach, expect, test } from 'bun:test'
import { decidedCard, isGhost, isReal, logLines, makeProject, ok, realCard, show, type Project } from './helpers.ts'

let p: Project
beforeEach(() => (p = makeProject()))
afterEach(() => p.cleanup())

const linkLine = (out: string, re: RegExp) => out.split('\n').filter((l) => l.startsWith('link:') && re.test(l))

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  realCard(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'sqlite', 'storage', '--type', 'depends_on', '--why', 'its basis'])
  const s1 = show(p, 'sqlite').stdout
  const held = linkLine(s1, /depends_on -> #storage/)
  expect(held.length).toBe(1)
  expect(held[0]).toContain('(held)')
  const st = show(p, 'storage').stdout
  expect(linkLine(st, /depends_on <- #sqlite/).filter((l) => !l.includes('(held)'))).toEqual([])
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s2 = show(p, 'sqlite').stdout
  const live = linkLine(s2, /depends_on -> #storage/)
  expect(live.length).toBe(1)
  expect(live[0]).not.toContain('(held)')
  const links = logLines(p).map((l) => JSON.parse(l)).filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  expect(links.length).toBe(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  realCard(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic', 'email', '--type', 'depends_on'])
  ok(p, ['accept', 'magic', '--actor', 'you'])
  expect(isReal(show(p, 'magic').stdout)).toBe(true)
  const a = show(p, 'auth').stdout
  expect(isReal(a)).toBe(true)
  expect(a).toContain('parent: #platform')
  expect(isGhost(show(p, 'email').stdout)).toBe(true)
  const dep = linkLine(show(p, 'magic').stdout, /depends_on -> #email/)
  expect(dep.length).toBe(1)
  expect(dep[0]).toContain('(held)')
})

test('63.3 an accept takes the card\'s own ghost options and sources with it', () => {
  // Reading: the contract needs a decided basis and a kill criterion, so Storage is decided and
  // Use SQLite gets a kill criterion; who is set before the status so the decide can pass.
  decidedCard(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy to run'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'sqlite', 'bench', '--type', 'supported_by'])
  ok(p, ['kill', 'sqlite', '--form', 'manual', '--text', 'use it a week'])
  const who = p.werk(['edit', 'sqlite', '--who', 'agent'])
  const status = p.werk(['status', 'sqlite', 'decided'])
  expect(who.code).toBe(0)
  expect(status.code).toBe(0)
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s = show(p, 'sqlite').stdout
  expect(isReal(s)).toBe(true)
  expect(s).toContain('status: decided')
  expect(s).toContain('who: agent')
  const o = show(p, 'pg').stdout
  expect(isReal(o)).toBe(true)
  expect(o).toContain('why-not: Too heavy to run')
  const b = show(p, 'bench').stdout
  expect(isReal(b)).toBe(true)
  expect(s).toContain('supported-by: #bench')
  expect(b).toMatch(/link: supported_by <- #sqlite(?! \(held\))/)
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  realCard(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  for (const id of ['auth', 'magic', 'pw']) expect(show(p, id).code).not.toBe(0)
  const pl = show(p, 'platform').stdout
  expect(isReal(pl)).toBe(true)
  expect(pl).not.toContain('#auth')
  expect(pl).not.toContain('#magic')
  expect(pl).not.toContain('#pw')
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  decidedCard(p, 'storage', 'Storage')
  decidedCard(p, 'cache', 'Cache', 'storage')
  const rollup = (out: string) => out.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollup(show(p, 'storage').stdout)
  expect(before).toBeDefined()
  const staleBefore = p.werk(['stale']).stdout
  expect(staleBefore).not.toContain('storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'agent'])
  ok(p, ['kill', 'sqlite', '--form', 'manual', '--text', 'use it a week'])
  ok(p, ['add', 'sqlite:opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'heavy'])
  ok(p, ['link', 'sqlite:opt', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['status', 'sqlite', 'decided'])
  expect(rollup(show(p, 'storage').stdout)).toBe(before!)
  expect(p.werk(['stale']).stdout).not.toContain('storage')
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const after = rollup(show(p, 'storage').stdout)!
  const cards = (l: string) => Number(/rollup: (\d+) cards/.exec(l)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
})
