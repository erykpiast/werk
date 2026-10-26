import { afterEach, expect, test } from 'bun:test'
import { decide, isGhost, isReal, logEvents, makeProject, ok, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const realCard = (id: string, title: string, extra: string[] = []) => {
  ok(p, ['add', id, '--title', title, ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
}

test('63.1 a link to a ghost is held, and goes live on accept with no extra link event', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'use-sqlite', 'storage', '--type', 'depends_on', '--why', 'basis'])
  expect(show(p, 'use-sqlite')).toMatch(/link: depends_on -> #storage \(held\)/)
  expect(show(p, 'storage')).not.toMatch(/link: depends_on <- #use-sqlite(?! \(held\))/)
  expect(show(p, 'storage')).not.toMatch(/link: depends_on <- #use-sqlite —/)
  ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
  const s = show(p, 'use-sqlite')
  expect(s).toContain('link: depends_on -> #storage')
  expect(s).not.toMatch(/depends_on -> #storage \(held\)/)
  const links = logEvents(p).filter((e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, not a ghost it depends on', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic-links', 'email-service', '--type', 'depends_on'])
  ok(p, ['accept', 'magic-links', '--actor', 'you'])
  expect(isReal(p, 'magic-links')).toBe(true)
  expect(isReal(p, 'auth')).toBe(true)
  expect(show(p, 'auth')).toContain('parent: #platform')
  expect(isGhost(p, 'email-service')).toBe(true)
  expect(show(p, 'magic-links')).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'])
  ok(p, ['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'use-sqlite', 'bench', '--type', 'supported_by'])
  // The later decide check needs a decided basis and a kill criterion; the binder adds them.
  decide(p, 'storage')
  ok(p, ['kill', 'use-sqlite', '--form', 'revisit'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'you'])
  const st = p.werk(['status', 'use-sqlite', 'decided'])
  ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
  const s = show(p, 'use-sqlite')
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const o = show(p, 'use-postgres')
  expect(o).toContain('state: real')
  expect(o).toContain('why-not: Needs a server')
  const b = show(p, 'bench')
  expect(b).toContain('state: real')
  expect(s).toMatch(/supported-by: .*#bench/)
  expect(s).not.toContain('(held)')
  expect({ status: st.code, statusErr: st.stderr, who: who.code, whoErr: who.stderr }).toEqual({ status: 0, statusErr: '', who: 0, whoErr: '' })
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  for (const id of ['auth', 'magic-links', 'passwords']) {
    const r = p.werk(['show', id])
    expect(r.code).not.toBe(0)
  }
  const s = show(p, 'platform')
  expect(s).toContain('state: real')
  for (const t of ['auth', 'magic-links', 'passwords']) expect(s).not.toContain(`#${t}`)
  const { fold } = require('../../src/map/fold.ts')
  const { toGraph } = require('../../src/map/graph.ts')
  const { readLog } = require('../../src/map/log.ts')
  const g = toGraph(fold(readLog(`${p.dir}/.werk/log.jsonl`)))
  expect(g.nodes.map((n: { id: string }) => n.id)).toEqual(['platform'])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  decide(p, 'storage')
  ok(p, ['add', 'child', '--title', 'Child', '--parent', 'storage'])
  ok(p, ['accept', 'child', '--actor', 'you'])
  decide(p, 'child', { basis: true })
  const rollupOf = () => /rollup: .*/.exec(show(p, 'storage'))?.[0]
  const unchal = () => /(\d+) unchallenged/.exec(rollupOf() ?? '')?.[1]
  const before = rollupOf()
  const unBefore = unchal()
  expect(before).toBeDefined()
  expect(p.werk(['stale']).stdout).toContain('nothing is marked')
  ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  decide(p, 'use-sqlite', { basis: true })
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Alt'])
  ok(p, ['link', 'opt', 'use-sqlite', '--type', 'alternative_to'])
  expect(rollupOf()).toBe(before)
  expect(unchal()).toBe(unBefore)
  expect(p.werk(['stale']).stdout).toContain('nothing is marked')
  ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
  const after = rollupOf()!
  const cards = (s: string) => Number(/rollup: (\d+) cards/.exec(s)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
})
