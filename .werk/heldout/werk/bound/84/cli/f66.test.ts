/** Feature 66: remove, restore, reparent, find. */
import { afterEach, expect, test } from 'bun:test'
import { accepted, childrenInMap, events, killed, linked, makeProject, noBasis, ok, proposed, seed, statusSet, reopened, type Project } from './helpers.ts'
import type { NewEvent } from '../../src/map/events.ts'

let p: Project
afterEach(() => p?.cleanup())
const real = (id: string, title: string, parent?: string, status = 'open'): NewEvent[] => [
  proposed(id, { title, status, ...(parent && { parent }) }),
  accepted(id),
]
const show = (id: string) => p.werk(['show', id]).stdout

test('66.1 an agent removes a bad branch and the log keeps its history', () => {
  p = makeProject()
  seed(p, ...real('storage', 'Storage'), ...real('cache', 'Cache', 'storage'), ...real('index', 'Index', 'storage'), ...real('eviction', 'Eviction', 'cache'))
  const before = events(p)
  // The agent removes the card. The step does not say the person asked for it.
  const r = p.werk(['remove', 'cache'])
  console.log('66.1 agent remove:', r.code, r.stderr.trim())
  const agentRemoved = r.code === 0
  if (!agentRemoved) ok(p, ['remove', 'cache', '--actor', 'you'])
  expect(show('cache')).toContain('removed')
  expect(show('eviction')).toContain('removed')
  const under = childrenInMap(p, 'storage')
  expect(under).not.toContain('cache')
  expect(under).not.toContain('eviction')
  expect(under).toContain('index')
  expect(p.werk(['removed']).stdout).toContain('#cache')
  const after = events(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(agentRemoved).toBe(true)
})

test('66.2 a person restores a removed card and its subtree with their links', () => {
  p = makeProject()
  seed(
    p,
    ...real('storage', 'Storage'),
    ...real('cache', 'Cache', 'storage'),
    ...real('eviction', 'Eviction', 'cache'),
    ...real('memory-budget', 'Memory budget'),
    linked('cache', 'memory-budget', 'depends_on'),
  )
  ok(p, ['remove', 'cache', '--actor', 'you'])
  const r = p.werk(['restore', 'cache'])
  expect(r.code).toBe(0)
  expect(show('cache')).not.toContain('removed')
  expect(childrenInMap(p, 'storage')).toContain('cache')
  expect(childrenInMap(p, 'cache')).toContain('eviction')
  expect(show('cache')).toContain('link: depends_on -> #memory-budget')
  expect(p.werk(['removed']).stdout).not.toContain('#cache')
})

test('66.3 an agent removes a bad parent but keeps its good children', () => {
  p = makeProject()
  seed(p, ...real('storage', 'Storage'), ...real('bad-layer', 'Bad layer', 'storage'), ...real('write-path', 'Write path', 'bad-layer'), ...real('read-path', 'Read path', 'bad-layer'))
  const r = p.werk(['remove', 'bad-layer', '--reparent'])
  console.log('66.3 agent remove:', r.code, r.stderr.trim())
  const agentRemoved = r.code === 0
  if (!agentRemoved) ok(p, ['remove', 'bad-layer', '--reparent', '--actor', 'you'])
  expect(show('bad-layer')).toContain('removed')
  const under = childrenInMap(p, 'storage')
  expect(under).toContain('write-path')
  expect(under).toContain('read-path')
  expect(show('write-path')).not.toContain('removed')
  expect(show('read-path')).not.toContain('removed')
  expect(agentRemoved).toBe(true)
})

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  p = makeProject()
  const decidedRoot = (id: string): NewEvent[] => [
    proposed(id, { title: id, who: 'me' }),
    accepted(id),
    noBasis(id, 'root'),
    killed(id),
    statusSet(id, 'decided'),
  ]
  seed(
    p,
    ...decidedRoot('later-thing'),
    ...decidedRoot('wrong-thing'),
    ...real('storage', 'Storage'),
    ...real('cache', 'Cache', 'storage'),
    ...real('index', 'Index', 'storage'),
    ...real('backup', 'Backup', 'storage'),
    ...real('quota', 'Quota', 'storage'),
    linked('backup', 'later-thing', 'depends_on'),
    linked('quota', 'wrong-thing', 'depends_on'),
    ...real('outside', 'Outside card'),
    reopened('later-thing', 'postponed'),
    reopened('wrong-thing', 'rejected'),
  )
  const stale = p.werk(['stale']).stdout
  expect(stale).toMatch(/paused\s+#backup/)
  expect(stale).toMatch(/stale\s+#quota/)
  const r = p.werk(['find', 'storage'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('#cache')
  expect(r.stdout).toContain('#index')
  expect(r.stdout).not.toContain('#backup')
  expect(r.stdout).not.toContain('#quota')
  expect(r.stdout).not.toContain('#outside')
})

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  p = makeProject()
  seed(p, ...real('storage', 'Storage'), ...real('cache', 'Cache', 'storage'), ...real('index', 'Index', 'storage'))
  ok(p, ['remove', 'cache', '--actor', 'you'])
  const r = p.werk(['find', 'storage'])
  expect(r.stdout).toContain('#index')
  expect(r.stdout).not.toContain('#cache')
  ok(p, ['restore', 'cache'])
  const again = p.werk(['find', 'storage'])
  expect(again.stdout).toContain('#cache')
  expect(again.stdout).toContain('#index')
})
