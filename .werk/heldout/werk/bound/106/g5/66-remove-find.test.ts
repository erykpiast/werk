/** Held-out steps 66.1-66.5: remove, restore, removed and find. */
import { expect, test } from 'bun:test'
import { accepted, linked, proposed, real, reopened, statusSet } from '../../src/test/map-events.ts'
import { logLines, mapOf, seeded } from './util.ts'

const card = (id: string, title: string, parent?: string) => [proposed(id, { title, status: 'open', ...(parent && { parent }) }), accepted(id)]

test('66.1 An agent removes a bad branch and the log keeps its history', async () => {
  const p = seeded([
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', 'storage'),
    ...card('index', 'Index', 'storage'),
    ...card('eviction', 'Eviction', 'cache'),
  ])
  const before = logLines(p)
  const r = p.werk(['remove', 'cache', '--actor', 'you'])
  expect(r.code).toBe(0)
  expect(p.werk(['show', 'cache']).stdout).toMatch(/state: removed/)
  expect(p.werk(['show', 'eviction']).stdout).toMatch(/state: removed/)
  const map = await mapOf(p)
  expect(map.has('cache')).toBe(false)
  expect(map.has('eviction')).toBe(false)
  expect(map.parentOf('index')).toBe('storage')
  expect(p.werk(['removed']).stdout).toMatch(/#cache\b/)
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 A person restores a removed card and its subtree with their links', async () => {
  const p = seeded([
    ...card('storage', 'Storage'),
    ...card('memory-budget', 'Memory budget'),
    ...card('cache', 'Cache', 'storage'),
    ...card('eviction', 'Eviction', 'cache'),
    linked('cache', 'memory-budget', 'depends_on'),
  ])
  expect(p.werk(['remove', 'cache', '--actor', 'you']).code).toBe(0)
  const r = p.werk(['restore', 'cache'])
  expect(r.code).toBe(0)
  const show = p.werk(['show', 'cache']).stdout
  expect(show).not.toMatch(/state: removed/)
  const map = await mapOf(p)
  expect(map.parentOf('cache')).toBe('storage')
  expect(map.parentOf('eviction')).toBe('cache')
  expect(show).toMatch(/depends_on -> #memory-budget/)
  expect(p.werk(['removed']).stdout).not.toMatch(/#cache\b/)
})

test('66.3 An agent removes a bad parent but keeps its good children', async () => {
  const p = seeded([
    ...card('storage', 'Storage'),
    ...card('bad-layer', 'Bad layer', 'storage'),
    ...card('write-path', 'Write path', 'bad-layer'),
    ...card('read-path', 'Read path', 'bad-layer'),
  ])
  expect(p.werk(['remove', 'bad-layer', '--reparent', '--actor', 'you']).code).toBe(0)
  expect(p.werk(['show', 'bad-layer']).stdout).toMatch(/state: removed/)
  const map = await mapOf(p)
  expect(map.parentOf('write-path')).toBe('storage')
  expect(map.parentOf('read-path')).toBe('storage')
  expect(p.werk(['show', 'write-path']).stdout).not.toMatch(/state: removed/)
  expect(p.werk(['show', 'read-path']).stdout).not.toMatch(/state: removed/)
})

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  const p = seeded([
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', 'storage'),
    ...card('index', 'Index', 'storage'),
    ...card('backup', 'Backup', 'storage'),
    ...card('quota', 'Quota', 'storage'),
    ...real('vendor'),
    statusSet('vendor', 'decided'),
    ...real('budget'),
    statusSet('budget', 'decided'),
    linked('backup', 'vendor', 'depends_on'),
    linked('quota', 'budget', 'depends_on'),
    reopened('vendor', 'postponed'),
    reopened('budget', 'rejected'),
    ...card('outside', 'Outside'),
  ])
  const stale = p.werk(['stale']).stdout
  expect(stale).toMatch(/#backup[\s\S]*paused|paused[\s\S]*#backup/)
  expect(stale).toMatch(/#quota/)
  const r = p.werk(['find', 'storage'])
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/#cache\b/)
  expect(r.stdout).toMatch(/#index\b/)
  expect(r.stdout).not.toMatch(/#backup\b/)
  expect(r.stdout).not.toMatch(/#quota\b/)
  expect(r.stdout).not.toMatch(/#outside\b/)
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  const p = seeded([...card('storage', 'Storage'), ...card('cache', 'Cache', 'storage'), ...card('index', 'Index', 'storage')])
  expect(p.werk(['remove', 'cache', '--actor', 'you']).code).toBe(0)
  const first = p.werk(['find', 'storage']).stdout
  expect(first).toMatch(/#index\b/)
  expect(first).not.toMatch(/#cache\b/)
  expect(p.werk(['restore', 'cache']).code).toBe(0)
  const again = p.werk(['find', 'storage']).stdout
  expect(again).toMatch(/#cache\b/)
  expect(again).toMatch(/#index\b/)
})
