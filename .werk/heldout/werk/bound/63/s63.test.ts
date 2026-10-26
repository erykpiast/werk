import { afterEach, expect, test } from 'bun:test'
import { logEvents, makeProject, ok, realCard, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const lines = (out: string) => out.split('\n')

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = makeProject()
  realCard(p, 'storage', 'Storage')
  ok(p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage']), 'propose')
  ok(p.werk(['link', 'use-sqlite', 'storage', '--type', 'depends_on']), 'link')

  expect(lines(show(p, 'use-sqlite').stdout)).toContain('link: depends_on -> #storage (held)')
  const storageLines = lines(show(p, 'storage').stdout)
  expect(storageLines).not.toContain('link: depends_on <- #use-sqlite')

  ok(p.werk(['accept', 'use-sqlite', '--actor', 'you']), 'accept')
  expect(lines(show(p, 'use-sqlite').stdout)).toContain('link: depends_on -> #storage')
  const linkEvents = logEvents(p).filter(
    (e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
  )
  expect(linkEvents.length).toBe(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = makeProject()
  realCard(p, 'platform', 'Platform')
  ok(p.werk(['add', 'auth', '--title', 'Auth', '--parent', 'platform']), 'auth')
  ok(p.werk(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth']), 'magic')
  ok(p.werk(['add', 'email-service', '--title', 'Email service', '--parent', 'platform']), 'email')
  ok(p.werk(['link', 'magic-links', 'email-service', '--type', 'depends_on']), 'link')

  ok(p.werk(['accept', 'magic-links', '--actor', 'you']), 'accept')
  const m = show(p, 'magic-links').stdout
  expect(m).toContain('state: real')
  const a = show(p, 'auth').stdout
  expect(a).toContain('state: real')
  expect(a).toContain('parent: #platform')
  expect(show(p, 'email-service').stdout).toMatch(/ghost/)
  expect(lines(m)).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = makeProject()
  realCard(p, 'storage', 'Storage')
  ok(p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage']), 'card')
  ok(p.werk(['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server']), 'option')
  ok(p.werk(['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to']), 'link option')
  ok(p.werk(['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes']), 'source')
  ok(p.werk(['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by']), 'link source')
  const status = p.werk(['status', 'use-sqlite', 'decided'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'you'])

  ok(p.werk(['accept', 'use-sqlite', '--actor', 'you']), 'accept')
  const c = show(p, 'use-sqlite').stdout
  expect(c).toContain('state: real')
  expect(c).toContain('status: decided')
  expect(c).toContain('who: you')
  const o = show(p, 'use-postgres').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('kind: option')
  expect(o).toContain('why-not: Needs a server')
  const s = show(p, 'benchmark-notes').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('kind: source')
  expect(lines(s)).toContain('link: supported_by <- #use-sqlite')
  expect(status.code).toBe(0)
  expect(who.code).toBe(0)
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = makeProject()
  realCard(p, 'platform', 'Platform')
  ok(p.werk(['add', 'auth', '--title', 'Auth', '--parent', 'platform']), 'auth')
  ok(p.werk(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth']), 'magic')
  ok(p.werk(['add', 'passwords', '--kind', 'option', '--title', 'Passwords']), 'option')
  ok(p.werk(['link', 'passwords', 'magic-links', '--type', 'alternative_to']), 'link option')

  ok(p.werk(['discard', 'auth']), 'discard')
  for (const id of ['auth', 'magic-links', 'passwords']) {
    const r = show(p, id)
    expect(r.code).not.toBe(0)
    expect(r.stdout).toBe('')
  }
  const pl = show(p, 'platform').stdout
  expect(pl).toContain('state: real')
  for (const word of ['auth', 'magic-links', 'passwords', 'held', 'ghost']) expect(pl).not.toContain(word)
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  realCard(p, 'storage', 'Storage')
  realCard(p, 'use-files', 'Use files', ['--parent', 'storage', '--who', 'you'])
  ok(p.werk(['status', 'use-files', 'decided', '--unchallenged']), 'decide child')

  const rollupOf = (out: string) => lines(out).find((l) => l.startsWith('rollup:'))
  const before = show(p, 'storage').stdout
  const r0 = rollupOf(before)
  expect(r0).toBeDefined()
  expect(r0).toContain('2 cards')
  expect(r0).toContain('1 unchallenged')
  expect(before.toLowerCase()).not.toContain('stale')

  ok(p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--status', 'decided']), 'ghost card')
  ok(p.werk(['add', 'use-pg', '--kind', 'option', '--title', 'Use Postgres']), 'ghost option')
  ok(p.werk(['link', 'use-pg', 'use-sqlite', '--type', 'alternative_to']), 'link option')

  const mid = show(p, 'storage').stdout
  expect(rollupOf(mid)).toBe(r0!)
  expect(mid.toLowerCase()).not.toContain('stale')

  ok(p.werk(['accept', 'use-sqlite', '--actor', 'you']), 'accept')
  const r2 = rollupOf(show(p, 'storage').stdout)
  expect(r2).toContain('3 cards')
})
