import { afterEach, expect, test } from 'bun:test'
import { childrenIn, ok, project, type P } from '../lib.ts'
import { accepted, killed, proposed, whoSet, noBasis } from '../../src/test/map-events.ts'

let p: P
afterEach(() => p?.cleanup())

const realCard = (id: string, title: string) => {
  ok(p.w('add', id, '--title', title))
  ok(p.w('accept', id, '--actor', 'you'))
}

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = project()
  realCard('storage', 'Storage')
  ok(p.w('add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'))
  ok(p.w('link', 'use-sqlite', 'storage', '--type', 'depends_on'))
  const edge = 'link: depends_on -> #storage'
  let show = ok(p.w('show', 'use-sqlite')).stdout
  expect(show).toContain(`${edge} (held)`)
  const storage = ok(p.w('show', 'storage')).stdout
  const live = storage.split('\n').filter((l) => l.startsWith('link:') && !l.includes('(held)'))
  expect(live.some((l) => l.includes('depends_on') && l.includes('use-sqlite'))).toBe(false)
  expect(p.state().edges.some((e) => e.from === 'use-sqlite' && e.to === 'storage' && e.type === 'depends_on')).toBe(false)

  ok(p.w('accept', 'use-sqlite', '--actor', 'you'))
  show = ok(p.w('show', 'use-sqlite')).stdout
  expect(show).toContain(edge)
  expect(show).not.toContain(`${edge} (held)`)
  const links = p.events().filter((e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  expect(links.length).toBe(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = project()
  realCard('platform', 'Platform')
  ok(p.w('add', 'auth', '--title', 'Auth', '--parent', 'platform'))
  ok(p.w('add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'))
  ok(p.w('add', 'email-service', '--title', 'Email service', '--parent', 'platform'))
  ok(p.w('link', 'magic-links', 'email-service', '--type', 'depends_on'))
  ok(p.w('accept', 'magic-links', '--actor', 'you'))
  expect(ok(p.w('show', 'magic-links')).stdout).toContain('state: real')
  const auth = ok(p.w('show', 'auth')).stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(ok(p.w('show', 'email-service')).stdout).toContain('ghost')
  expect(ok(p.w('show', 'magic-links')).stdout).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = project()
  // A real card "Storage", decided, so a child can rest on it.
  p.seed(proposed('storage', { title: 'Storage', status: 'decided', who: 'me' }), noBasis('storage', 'the root'), killed('storage'), accepted('storage'))
  ok(p.w('add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'))
  ok(p.w('add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'))
  ok(p.w('link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'))
  ok(p.w('add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'))
  ok(p.w('link', 'use-sqlite', 'bench', '--type', 'supported_by'))
  // A kill criterion is a later contract fact; the Given needs it for decided to pass.
  ok(p.w('kill', 'use-sqlite', '--form', 'manual', '--text', 'use it for a week'))
  const who = p.w('edit', 'use-sqlite', '--who', 'you')
  const status = p.w('status', 'use-sqlite', 'decided')
  expect({ who: who.code, status: status.code, err: status.stderr + who.stderr }).toEqual({ who: 0, status: 0, err: '' })

  ok(p.w('accept', 'use-sqlite', '--actor', 'you'))
  const card = ok(p.w('show', 'use-sqlite')).stdout
  expect(card).toContain('state: real')
  expect(card).toContain('status: decided')
  expect(card).toContain('who: you')
  const opt = ok(p.w('show', 'use-postgres')).stdout
  expect(opt).toContain('state: real')
  expect(opt).toContain('why-not: Needs a server')
  const src = ok(p.w('show', 'bench')).stdout
  expect(src).toContain('state: real')
  expect(p.state().edges).toContainEqual(expect.objectContaining({ from: 'use-sqlite', to: 'bench', type: 'supported_by' }))
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = project()
  realCard('platform', 'Platform')
  ok(p.w('add', 'auth', '--title', 'Auth', '--parent', 'platform'))
  ok(p.w('add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'))
  ok(p.w('add', 'passwords', '--kind', 'option', '--title', 'Passwords'))
  ok(p.w('link', 'passwords', 'magic-links', '--type', 'alternative_to'))
  ok(p.w('discard', 'auth'))
  for (const id of ['auth', 'magic-links', 'passwords']) {
    expect(p.state().nodes.has(id)).toBe(false)
    expect(p.w('show', id).code).not.toBe(0)
  }
  const platform = ok(p.w('show', 'platform')).stdout
  expect(platform).toContain('state: real')
  expect(platform).not.toContain('auth')
  expect(childrenIn(p.state(), 'platform')).toEqual([])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = project()
  p.seed(
    proposed('storage', { title: 'Storage', status: 'decided', who: 'me' }),
    noBasis('storage', 'the root'),
    killed('storage'),
    accepted('storage'),
    proposed('cache', { title: 'Cache', parent: 'storage', status: 'decided', who: 'me' }),
    killed('cache'),
    accepted('cache'),
  )
  const rollupOf = () => ok(p.w('show', 'storage')).stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(before).toContain('unchallenged')
  const staleBefore = ok(p.w('stale')).stdout
  expect(staleBefore).not.toContain('#storage')

  ok(p.w('add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'))
  ok(p.w('kill', 'use-sqlite', '--form', 'manual', '--text', 'use it for a week'))
  ok(p.w('add', 'use-pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'))
  ok(p.w('link', 'use-pg', 'use-sqlite', '--type', 'alternative_to'))
  ok(p.w('status', 'use-sqlite', 'decided'))
  expect(rollupOf()).toBe(before)
  expect(ok(p.w('stale')).stdout).not.toContain('#storage')

  ok(p.w('accept', 'use-sqlite', '--actor', 'you'))
  const after = rollupOf()!
  const cards = (l: string) => Number(/rollup: (\d+) cards/.exec(l)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
})
