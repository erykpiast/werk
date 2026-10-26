import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { linked, reopened } from '../../src/test/map-events.ts'
import { childIds, logLines, ok, projectWith, realCard } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

const found = (out: string) => out.split('\n').flatMap((l) => (/#([\w-]+)/.exec(l)?.[1] ? [/#([\w-]+)/.exec(l)![1]!] : []))

test('66.1 An agent removes a bad branch and the log keeps its history', () => {
  p = projectWith(
    ...realCard('storage', 'Storage'),
    ...realCard('cache', 'Cache', { parent: 'storage' }),
    ...realCard('index', 'Index', { parent: 'storage' }),
    ...realCard('eviction', 'Eviction', { parent: 'cache' }),
  )
  const before = logLines(p)
  ok(p, ['remove', 'cache', '--actor', 'you'])
  expect(ok(p, ['show', 'cache'])).toContain('state: removed')
  expect(ok(p, ['show', 'eviction'])).toContain('state: removed')
  const kids = childIds(p, 'storage')!
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(p, ['removed'])).toContain('#cache')
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 A person restores a removed card and its subtree with their links', () => {
  p = projectWith(
    ...realCard('storage', 'Storage'),
    ...realCard('cache', 'Cache', { parent: 'storage' }),
    ...realCard('eviction', 'Eviction', { parent: 'cache' }),
    ...realCard('memory-budget', 'Memory budget'),
    linked('cache', 'memory-budget', 'depends_on'),
  )
  ok(p, ['remove', 'cache', '--actor', 'you'])
  ok(p, ['restore', 'cache'])
  const show = ok(p, ['show', 'cache'])
  expect(show).not.toContain('removed')
  expect(childIds(p, 'storage')).toContain('cache')
  expect(childIds(p, 'cache')).toContain('eviction')
  expect(show).toContain('link: depends_on -> #memory-budget')
  expect(ok(p, ['removed'])).not.toContain('#cache')
})

test('66.3 An agent removes a bad parent but keeps its good children', () => {
  p = projectWith(
    ...realCard('storage', 'Storage'),
    ...realCard('bad-layer', 'Bad layer', { parent: 'storage' }),
    ...realCard('write-path', 'Write path', { parent: 'bad-layer' }),
    ...realCard('read-path', 'Read path', { parent: 'bad-layer' }),
  )
  ok(p, ['remove', 'bad-layer', '--actor', 'you', '--reparent'])
  expect(ok(p, ['show', 'bad-layer'])).toContain('state: removed')
  const kids = childIds(p, 'storage')!
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  expect(ok(p, ['show', 'write-path'])).not.toContain('removed')
  expect(ok(p, ['show', 'read-path'])).not.toContain('removed')
})

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  p = projectWith(
    ...realCard('storage', 'Storage', { status: 'decided' }),
    ...realCard('cache', 'Cache', { parent: 'storage', status: 'open' }),
    ...realCard('index', 'Index', { parent: 'storage', status: 'open' }),
    ...realCard('backup', 'Backup', { parent: 'storage', status: 'open' }),
    ...realCard('quota', 'Quota', { parent: 'storage', status: 'open' }),
    ...realCard('later-thing', 'Later thing', { status: 'decided' }),
    ...realCard('wrong-thing', 'Wrong thing', { status: 'decided' }),
    ...realCard('elsewhere', 'Elsewhere', { status: 'open' }),
    linked('backup', 'later-thing', 'depends_on'),
    linked('quota', 'wrong-thing', 'depends_on'),
    reopened('later-thing', 'postponed'),
    reopened('wrong-thing', 'rejected'),
  )
  const ids = found(ok(p, ['find', 'storage']))
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('elsewhere')
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  p = projectWith(
    ...realCard('storage', 'Storage', { status: 'decided' }),
    ...realCard('cache', 'Cache', { parent: 'storage', status: 'open' }),
    ...realCard('index', 'Index', { parent: 'storage', status: 'open' }),
  )
  ok(p, ['remove', 'cache', '--actor', 'you'])
  let ids = found(ok(p, ['find', 'storage']))
  expect(ids).toContain('index')
  expect(ids).not.toContain('cache')
  ok(p, ['restore', 'cache'])
  ids = found(ok(p, ['find', 'storage']))
  expect(ids).toContain('index')
  expect(ids).toContain('cache')
})
