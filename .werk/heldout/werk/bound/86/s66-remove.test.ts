import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { newCtx, type Ctx } from './cli-helpers.ts'

let c: Ctx
afterEach(() => c?.p.cleanup())

const isRemoved = (id: string) => /^state: removed/m.test(c.show(id).stdout)
const findIds = (root: string) => {
  const r = c.w('find', root)
  expect(r.code).toBe(0)
  return [...r.stdout.matchAll(/#(\S+)/g)].map((m) => m[1]!)
}

test('66.1 an agent removes a bad branch and the log keeps its history', () => {
  c = newCtx()
  c.real('storage', 'Storage')
  c.real('cache', 'Cache', { parent: 'storage' })
  c.real('index', 'Index', { parent: 'storage' })
  c.real('eviction', 'Eviction', { parent: 'cache' })
  const before = c.lines()

  // remove is for the person alone: the agent passes the claim that the person asked for it.
  expect(c.w('remove', 'cache', '--actor', 'you').code).toBe(0)
  expect(isRemoved('cache')).toBe(true)
  expect(isRemoved('eviction')).toBe(true)
  const under = c.childIds('storage')!
  expect(under).not.toContain('cache')
  expect(under).not.toContain('eviction')
  expect(under).toContain('index')
  expect(c.w('removed').stdout).toContain('#cache')
  const after = c.lines()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 a person restores a removed card and its subtree with their links', () => {
  c = newCtx()
  c.real('storage', 'Storage')
  c.real('cache', 'Cache', { parent: 'storage' })
  c.real('eviction', 'Eviction', { parent: 'cache' })
  c.real('memory-budget', 'Memory budget')
  c.ok('link', 'cache', 'memory-budget', '--type', 'depends_on')
  c.ok('remove', 'cache', '--actor', 'you')

  expect(c.w('restore', 'cache').code).toBe(0)
  expect(isRemoved('cache')).toBe(false)
  expect(c.childIds('storage')).toContain('cache')
  expect(c.childIds('cache')).toContain('eviction')
  expect(c.show('cache').stdout).toContain('depends_on -> #memory-budget')
  expect(c.w('removed').stdout).not.toContain('#cache')
})

test('66.3 an agent removes a bad parent but keeps its good children', () => {
  c = newCtx()
  c.real('storage', 'Storage')
  c.real('bad-layer', 'Bad layer', { parent: 'storage' })
  c.real('write-path', 'Write path', { parent: 'bad-layer' })
  c.real('read-path', 'Read path', { parent: 'bad-layer' })

  expect(c.w('remove', 'bad-layer', '--reparent', '--actor', 'you').code).toBe(0)
  expect(isRemoved('bad-layer')).toBe(true)
  const under = c.childIds('storage')!
  expect(under).toContain('write-path')
  expect(under).toContain('read-path')
  expect(isRemoved('write-path')).toBe(false)
  expect(isRemoved('read-path')).toBe(false)
})

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  c = newCtx()
  c.decided('later', 'Postponed basis')
  c.decided('wrong', 'Rejected basis')
  c.real('storage', 'Storage')
  for (const [id, title] of [
    ['cache', 'Cache'],
    ['index', 'Index'],
    ['backup', 'Backup'],
    ['quota', 'Quota'],
  ] as const)
    c.real(id, title, { parent: 'storage', status: 'open' })
  c.ok('link', 'backup', 'later', '--type', 'depends_on')
  c.ok('link', 'quota', 'wrong', '--type', 'depends_on')
  c.ok('reopen', 'later', '--reason', 'postponed', '--why', 'not now')
  c.ok('reopen', 'wrong', '--reason', 'rejected', '--why', 'wrong choice')
  c.real('outside', 'Outside card', { status: 'open' })
  expect(c.graph().marks.backup?.mark).toBe('paused')
  expect(c.graph().marks.quota?.mark).toBe('stale')

  const ids = findIds('storage')
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('outside')
})

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  c = newCtx()
  c.real('storage', 'Storage')
  c.real('cache', 'Cache', { parent: 'storage', status: 'open' })
  c.real('index', 'Index', { parent: 'storage', status: 'open' })
  c.ok('remove', 'cache', '--actor', 'you')
  let ids = findIds('storage')
  expect(ids).toContain('index')
  expect(ids).not.toContain('cache')
  c.ok('restore', 'cache')
  ids = findIds('storage')
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
})
