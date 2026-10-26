import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { newCtx, type Ctx } from './cli-helpers.ts'

let c: Ctx
afterEach(() => c?.p.cleanup())

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  c = newCtx()
  c.real('storage', 'Storage')
  c.ok('add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage')
  c.ok('link', 'use-sqlite', 'storage', '--type', 'depends_on')
  expect(c.show('use-sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const liveOfStorage = c.graph().edges.filter((e) => e.from === 'storage' || e.to === 'storage')
  expect(liveOfStorage.some((e) => e.from === 'use-sqlite' && e.type === 'depends_on')).toBe(false)
  const storageShow = c.show('storage').stdout.split('\n')
  expect(storageShow.some((l) => l.includes('depends_on <- #use-sqlite') && !l.includes('(held)'))).toBe(false)

  c.ok('accept', 'use-sqlite', '--actor', 'you')
  const s = c.show('use-sqlite').stdout.split('\n')
  expect(s).toContain('link: depends_on -> #storage')
  const links = c.events().filter(
    (e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
  )
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  c = newCtx()
  c.real('platform', 'Platform')
  c.ok('add', 'auth', '--title', 'Auth', '--parent', 'platform')
  c.ok('add', 'magic-links', '--title', 'Magic links', '--parent', 'auth')
  c.ok('add', 'email-service', '--title', 'Email service', '--parent', 'platform')
  c.ok('link', 'magic-links', 'email-service', '--type', 'depends_on')
  c.ok('accept', 'magic-links', '--actor', 'you')

  expect(c.show('magic-links').stdout).toContain('state: real')
  const auth = c.show('auth').stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(c.show('email-service').stdout).toContain('state: ghost')
  expect(c.show('magic-links').stdout).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  c = newCtx()
  c.decided('storage', 'Storage')
  c.ok('add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage')
  c.ok('add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server')
  c.ok('link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to')
  c.ok('add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes')
  c.ok('link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by')
  // A kill criterion is a contract fact a decide needs; it is set up here, before the status change.
  c.ok('kill', 'use-sqlite', '--form', 'manual', '--text', 'check the write speed')
  const who = c.w('edit', 'use-sqlite', '--who', 'me')
  const status = c.w('status', 'use-sqlite', 'decided')
  expect(who.code).toBe(0)
  expect(status.code).toBe(0)

  c.ok('accept', 'use-sqlite', '--actor', 'you')
  const s = c.show('use-sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: me')
  const o = c.show('use-postgres').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('kind: option')
  expect(o).toContain('why-not: Needs a server')
  expect(c.show('benchmark-notes').stdout).toContain('state: real')
  expect(c.graph().edges).toContainEqual({ from: 'use-sqlite', to: 'benchmark-notes', type: 'supported_by' })
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  c = newCtx()
  c.real('platform', 'Platform')
  c.ok('add', 'auth', '--title', 'Auth', '--parent', 'platform')
  c.ok('add', 'magic-links', '--title', 'Magic links', '--parent', 'auth')
  c.ok('add', 'passwords', '--kind', 'option', '--title', 'Passwords')
  c.ok('link', 'passwords', 'magic-links', '--type', 'alternative_to')
  c.ok('discard', 'auth')

  for (const id of ['auth', 'magic-links', 'passwords']) {
    expect(c.show(id).code).not.toBe(0)
    expect(c.graph().nodes.some((n) => n.id === id)).toBe(false)
  }
  const p = c.show('platform').stdout
  expect(p).toContain('state: real')
  expect(c.childIds('platform')).toEqual([])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  c = newCtx()
  c.decided('storage', 'Storage')
  c.decided('child', 'A decided child', { parent: 'storage' })
  const rollupOf = () => c.show('storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(c.graph().marks.storage).toBeUndefined()
  expect(c.w('stale').stdout).not.toContain('#storage')

  c.ok('add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage')
  c.ok('add', 'opt', '--kind', 'option', '--title', 'Use files', '--why-not', 'No queries')
  c.ok('link', 'opt', 'use-sqlite', '--type', 'alternative_to')
  c.ok('edit', 'use-sqlite', '--who', 'me')
  c.ok('kill', 'use-sqlite', '--form', 'revisit')
  c.ok('status', 'use-sqlite', 'decided')

  expect(rollupOf()).toBe(before)
  expect(c.graph().marks.storage).toBeUndefined()
  expect(c.w('stale').stdout).not.toContain('#storage')

  c.ok('accept', 'use-sqlite', '--actor', 'you')
  const after = rollupOf()!
  const cards = (l: string) => Number(/rollup: (\d+) cards/.exec(l)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
})
