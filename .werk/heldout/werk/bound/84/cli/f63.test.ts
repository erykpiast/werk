/** Feature 63: held links, accept branches, discard branches, counts. */
import { afterEach, expect, test } from 'bun:test'
import { accepted, childrenInMap, events, graph, killed, linked, makeProject, noBasis, ok, proposed, seed, statusSet, whoSet, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())
const show = (id: string) => p.werk(['show', id]).stdout

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = makeProject()
  seed(p, proposed('storage', { title: 'Storage' }), accepted('storage'))
  ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'use-sqlite', 'storage', '--type', 'depends_on', '--why', 'its basis'])
  expect(show('use-sqlite')).toContain('link: depends_on -> #storage (held)')
  const storage = show('storage')
  expect(storage).not.toMatch(/link: depends_on <- #use-sqlite(?! \(held\))/)
  expect(graph(p).edges).not.toContainEqual(expect.objectContaining({ from: 'use-sqlite', to: 'storage', type: 'depends_on' }))
  ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
  const after = show('use-sqlite')
  expect(after).toContain('link: depends_on -> #storage')
  expect(after).not.toContain('(held)')
  const links = events(p).filter((e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = makeProject()
  seed(p, proposed('platform', { title: 'Platform' }), accepted('platform'))
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic-links', 'email-service', '--type', 'depends_on'])
  ok(p, ['accept', 'magic-links', '--actor', 'you'])
  expect(show('magic-links')).toContain('state: real')
  const auth = show('auth')
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(show('email-service')).toContain('state: ghost')
  expect(show('magic-links')).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = makeProject()
  seed(
    p,
    proposed('storage', { title: 'Storage', who: 'me' }),
    accepted('storage'),
    noBasis('storage', 'the root of the map'),
    killed('storage'),
    statusSet('storage', 'decided'),
  )
  ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'A server for one user is too much'])
  ok(p, ['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by'])
  // The contract needs a kill criterion before a decide; the step does not name it, so it is set up here.
  ok(p, ['kill', 'use-sqlite', '--form', 'revisit'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'you'])
  const status = p.werk(['status', 'use-sqlite', 'decided'])
  ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
  const sqlite = show('use-sqlite')
  expect(sqlite).toContain('state: real')
  expect(sqlite).toContain('status: decided')
  expect(sqlite).toContain('who: you')
  const pg = show('use-postgres')
  expect(pg).toContain('state: real')
  expect(pg).toContain('why-not: A server for one user is too much')
  const bench = show('benchmark-notes')
  expect(bench).toContain('state: real')
  expect(graph(p).edges).toContainEqual(expect.objectContaining({ from: 'use-sqlite', to: 'benchmark-notes', type: 'supported_by' }))
  expect({ code: who.code, err: who.stderr }).toEqual({ code: 0, err: '' })
  expect({ code: status.code, err: status.stderr }).toEqual({ code: 0, err: '' })
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = makeProject()
  seed(p, proposed('platform', { title: 'Platform' }), accepted('platform'))
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  const ids = graph(p).nodes.map((n) => n.id)
  for (const id of ['auth', 'magic-links', 'passwords']) {
    expect(ids).not.toContain(id)
    expect(p.werk(['show', id]).code).not.toBe(0)
  }
  expect(show('platform')).toContain('state: real')
  expect(childrenInMap(p, 'platform')).toEqual([])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  seed(
    p,
    proposed('storage', { title: 'Storage', who: 'me' }),
    accepted('storage'),
    noBasis('storage', 'the root of the map'),
    killed('storage'),
    statusSet('storage', 'decided'),
    proposed('child', { title: 'Child', who: 'me', parent: 'storage' }),
    accepted('child'),
    killed('child'),
    statusSet('child', 'decided'),
  )
  const rollup = () => /rollup: .*/.exec(show('storage'))?.[0]
  const before = rollup()
  expect(before).toBeDefined()
  expect(before).toContain('unchallenged')
  const staleBefore = p.werk(['stale']).stdout
  expect(staleBefore).toContain('nothing is marked')

  ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(p, ['kill', 'use-sqlite', '--form', 'revisit'])
  ok(p, ['status', 'use-sqlite', 'decided'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Use files', '--why-not', 'No queries'])
  ok(p, ['link', 'opt', 'use-sqlite', '--type', 'alternative_to'])
  expect(rollup()).toBe(before!)
  expect(p.werk(['stale']).stdout).toContain('nothing is marked')
  expect(graph(p).marks['storage']).toBeUndefined()

  ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
  const after = rollup()!
  expect(Number(/(\d+) cards/.exec(after)![1])).toBe(Number(/(\d+) cards/.exec(before!)![1]) + 1)
  expect(Number(/(\d+) decided/.exec(after)![1])).toBe(Number(/(\d+) decided/.exec(before!)![1]) + 1)
})
