/** Held-out steps 63.x: held links, accept branches, discard, and counts. */
import { expect, test } from 'bun:test'
import { childrenInMap, decidedCard, events, graph, inMap, markOf, ok, project, realCard, show } from './helpers.ts'

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  const p = project()
  realCard(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'sqlite', 'storage', '--type', 'depends_on'])
  expect(show(p, 'sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const liveOfStorage = graph(p).edges.filter((e) => e.from === 'storage' || e.to === 'storage')
  expect(liveOfStorage.some((e) => e.from === 'sqlite' && e.type === 'depends_on')).toBe(false)
  expect(show(p, 'storage').stdout).not.toMatch(/link: depends_on <- #sqlite(?! \(held\))/)
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s = show(p, 'sqlite').stdout
  expect(s).toContain('link: depends_on -> #storage')
  expect(s).not.toContain('link: depends_on -> #storage (held)')
  const links = events(p).filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  const p = project()
  realCard(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic', 'email', '--type', 'depends_on'])
  ok(p, ['accept', 'magic', '--actor', 'you'])
  expect(show(p, 'magic').stdout).toContain('state: real')
  const auth = show(p, 'auth').stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(show(p, 'email').stdout).toContain('ghost')
  expect(show(p, 'magic').stdout).toContain('link: depends_on -> #email (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  const p = project()
  // Storage is decided and the ghost has a kill criterion, so the contract check of 64.x has its facts.
  decidedCard(p, 'storage', { title: 'Storage' })
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'It needs a server.'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'sqlite', 'bench', '--type', 'supported_by'])
  const who = p.werk(['edit', 'sqlite', '--who', 'agent'])
  const st = p.werk(['status', 'sqlite', 'decided'])
  // The status change and the who change while the card is a ghost: report what the agent got.
  console.log(`63.3 status: ${st.code} ${st.stderr.trim()} | who: ${who.code} ${who.stderr.trim()}`)
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s = show(p, 'sqlite').stdout
  expect(s).toContain('state: real')
  expect(who.code).toBe(0)
  expect(s).toContain('who: agent')
  const pg = show(p, 'pg').stdout
  expect(pg).toContain('state: real')
  expect(pg).toContain('why-not: It needs a server.')
  const bench = show(p, 'bench').stdout
  expect(bench).toContain('state: real')
  expect(graph(p).edges.some((e) => e.from === 'sqlite' && e.to === 'bench' && e.type === 'supported_by')).toBe(true)
  expect(st.code).toBe(0)
  expect(s).toContain('status: decided')
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  const p = project()
  realCard(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  for (const id of ['auth', 'magic', 'pw']) {
    expect(inMap(p, id)).toBe(false)
    expect(show(p, id).code).not.toBe(0)
  }
  expect(show(p, 'platform').stdout).toContain('state: real')
  expect(childrenInMap(p, 'platform')).toEqual([])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  const p = project()
  decidedCard(p, 'storage', { title: 'Storage' })
  decidedCard(p, 'files', { parent: 'storage', title: 'Files' })
  const rollup = () => show(p, 'storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollup()
  expect(before).toBeDefined()
  expect(markOf(p, 'storage')).toBeUndefined()

  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  ok(p, ['status', 'sqlite', 'decided'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'A server.'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  expect(rollup()).toBe(before)
  expect(markOf(p, 'storage')).toBeUndefined()

  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const after = rollup()!
  const cards = (l: string) => Number(l.match(/rollup: (\d+) cards/)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
})
