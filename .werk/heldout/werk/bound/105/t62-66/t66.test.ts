/** Held-out steps of ticket 66: remove, restore and find. */
import { expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

const children = (p: P, id: string) =>
  p
    .show(id)
    .split('\n')
    .flatMap((l) => {
      const m = l.match(/^link: refines <- #(\S+)/)
      return m && !l.includes('(held)') ? [m[1]!] : []
    })
const found = (p: P, root: string) =>
  p
    .ok('find', root)
    .stdout.split('\n')
    .flatMap((l) => {
      const m = l.match(/#(\S+)/)
      return m ? [m[1]!] : []
    })

test('66.1 An agent removes a bad branch and the log keeps its history', () => {
  const p = project()
  p.real('storage', 'Storage')
  p.real('cache', 'Cache', ['--parent', 'storage'])
  p.real('index', 'Index', ['--parent', 'storage'])
  p.real('eviction', 'Eviction', ['--parent', 'cache'])
  const before = p.logLines()
  p.ok('remove', 'cache', '--actor', 'you')
  expect(p.show('cache')).toContain('removed')
  expect(p.show('eviction')).toContain('removed')
  const kids = children(p, 'storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(p.ok('removed').stdout).toContain('#cache')
  const after = p.logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
})

test('66.2 A person restores a removed card and its subtree with their links', () => {
  const p = project()
  p.real('storage', 'Storage')
  p.real('memory-budget', 'Memory budget')
  p.real('cache', 'Cache', ['--parent', 'storage'])
  p.real('eviction', 'Eviction', ['--parent', 'cache'])
  p.ok('link', 'cache', 'memory-budget', '--type', 'depends_on')
  p.ok('remove', 'cache', '--actor', 'you')
  p.ok('restore', 'cache')
  const cache = p.show('cache')
  expect(cache).not.toContain('removed')
  expect(children(p, 'storage')).toContain('cache')
  expect(children(p, 'cache')).toContain('eviction')
  expect(cache).toContain('depends_on -> #memory-budget')
  expect(p.ok('removed').stdout).not.toContain('#cache')
})

test('66.3 An agent removes a bad parent but keeps its good children', () => {
  const p = project()
  p.real('storage', 'Storage')
  p.real('bad-layer', 'Bad layer', ['--parent', 'storage'])
  p.real('write-path', 'Write path', ['--parent', 'bad-layer'])
  p.real('read-path', 'Read path', ['--parent', 'bad-layer'])
  p.ok('remove', 'bad-layer', '--reparent', '--actor', 'you')
  expect(p.show('bad-layer')).toContain('removed')
  const kids = children(p, 'storage')
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  expect(p.show('write-path')).not.toContain('removed')
  expect(p.show('read-path')).not.toContain('removed')
})

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  const p = project()
  p.decided('postponed-basis', 'Engine')
  p.decided('rejected-basis', 'Vendor API')
  p.real('storage', 'Storage')
  for (const [id, t] of [['cache', 'Cache'], ['index', 'Index'], ['backup', 'Backup'], ['quota', 'Quota']] as const) {
    p.real(id, t, ['--parent', 'storage'])
  }
  p.ok('link', 'backup', 'postponed-basis', '--type', 'depends_on')
  p.ok('link', 'quota', 'rejected-basis', '--type', 'depends_on')
  p.ok('reopen', 'postponed-basis', '--reason', 'postponed', '--why', 'later')
  p.ok('reopen', 'rejected-basis', '--reason', 'rejected', '--why', 'wrong')
  p.real('outside', 'Outside work')
  const ids = found(p, 'storage')
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('outside')
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  const p = project()
  p.real('storage', 'Storage')
  p.real('cache', 'Cache', ['--parent', 'storage'])
  p.real('index', 'Index', ['--parent', 'storage'])
  p.ok('remove', 'cache', '--actor', 'you')
  let ids = found(p, 'storage')
  expect(ids).toContain('index')
  expect(ids).not.toContain('cache')
  p.ok('restore', 'cache')
  ids = found(p, 'storage')
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
})
