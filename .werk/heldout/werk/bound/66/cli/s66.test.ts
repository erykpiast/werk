import { afterEach, expect, test } from 'bun:test'
import { childrenIn, ok, project, type P } from '../lib.ts'
import { accepted, killed, linked, noBasis, proposed } from '../../src/test/map-events.ts'
import type { NewEvent } from '../../src/map/events.ts'

let p: P
afterEach(() => p?.cleanup())

const real = (id: string, title: string, parent?: string, status = 'open'): NewEvent[] => [
  proposed(id, { title, status, ...(parent && { parent }) }),
  accepted(id),
]
const decided = (id: string, title: string): NewEvent[] => [
  proposed(id, { title, status: 'decided', who: 'me' }),
  noBasis(id, 'a root'),
  killed(id),
  accepted(id),
]

const showOf = (id: string) => ok(p.w('show', id)).stdout
const isRemoved = (id: string) => /^state: removed/m.test(showOf(id))

/** The agent removes a card. The step names no claim of the person, so the call carries none. */
const agentRemoves = (id: string, ...flags: string[]) => {
  const r = p.w('remove', id, ...flags, ...(process.env.CLAIM ? ['--actor', 'you'] : []))
  expect(r.code, `werk remove ${id} ${flags.join(' ')}: ${r.stderr}`).toBe(0)
}

test('66.1 an agent removes a bad branch and the log keeps its history', () => {
  p = project()
  p.seed(...real('storage', 'Storage'), ...real('cache', 'Cache', 'storage'), ...real('index', 'Index', 'storage'), ...real('eviction', 'Eviction', 'cache'))
  const before = p.lines()
  agentRemoves('cache')
  expect(isRemoved('cache')).toBe(true)
  expect(isRemoved('eviction')).toBe(true)
  const kids = childrenIn(p.state(), 'storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(p.w('removed')).stdout).toContain('#cache')
  const after = p.lines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
})

test('66.2 a person restores a removed card and its subtree with their links', () => {
  p = project()
  p.seed(
    ...real('storage', 'Storage'),
    ...real('cache', 'Cache', 'storage'),
    ...real('eviction', 'Eviction', 'cache'),
    ...real('memory-budget', 'Memory budget'),
    linked('cache', 'memory-budget', 'depends_on'),
  )
  agentRemoves('cache')
  ok(p.w('restore', 'cache'))
  expect(isRemoved('cache')).toBe(false)
  expect(childrenIn(p.state(), 'storage')).toContain('cache')
  expect(childrenIn(p.state(), 'cache')).toContain('eviction')
  expect(showOf('cache')).toContain('link: depends_on -> #memory-budget')
  expect(ok(p.w('removed')).stdout).not.toContain('#cache')
})

test('66.3 an agent removes a bad parent but keeps its good children', () => {
  p = project()
  p.seed(...real('storage', 'Storage'), ...real('bad-layer', 'Bad layer', 'storage'), ...real('write-path', 'Write path', 'bad-layer'), ...real('read-path', 'Read path', 'bad-layer'))
  agentRemoves('bad-layer', '--reparent')
  expect(isRemoved('bad-layer')).toBe(true)
  const kids = childrenIn(p.state(), 'storage')
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  expect(isRemoved('write-path')).toBe(false)
  expect(isRemoved('read-path')).toBe(false)
})

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  p = project()
  p.seed(
    ...decided('later', 'Later'),
    ...decided('wrong', 'Wrong'),
    ...real('storage', 'Storage', undefined, 'decided'),
    ...real('cache', 'Cache', 'storage'),
    ...real('index', 'Index', 'storage'),
    ...real('backup', 'Backup', 'storage'),
    ...real('quota', 'Quota', 'storage'),
    linked('backup', 'later', 'depends_on'),
    linked('quota', 'wrong', 'depends_on'),
    ...real('outside', 'Outside'),
  )
  ok(p.w('reopen', 'later', '--reason', 'postponed', '--why', 'it waits'))
  ok(p.w('reopen', 'wrong', '--reason', 'rejected', '--why', 'it is wrong'))
  const stale = ok(p.w('stale')).stdout
  expect(stale).toMatch(/paused\s+#backup/)
  expect(stale).toMatch(/stale\s+#quota/)
  const out = ok(p.w('find', 'storage')).stdout
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
  expect(out).not.toContain('#backup')
  expect(out).not.toContain('#quota')
  expect(out).not.toContain('#outside')
})

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  p = project()
  p.seed(...real('storage', 'Storage', undefined, 'decided'), ...real('cache', 'Cache', 'storage'), ...real('index', 'Index', 'storage'))
  agentRemoves('cache')
  let out = ok(p.w('find', 'storage')).stdout
  expect(out).toContain('#index')
  expect(out).not.toContain('#cache')
  ok(p.w('restore', 'cache'))
  out = ok(p.w('find', 'storage')).stdout
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
})
