/** Held-out steps 66.x: remove, restore and find. The remove verb needs the person claim, --actor you. */
import { expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { childrenInMap, decidedCard, lines, ok, project, realCard, show } from './helpers.ts'

const openCard = (p: Project, id: string, title: string, parent?: string) => {
  realCard(p, id, title, parent)
  ok(p, ['status', id, 'open'])
}

test('66.1 an agent removes a bad branch and the log keeps its history', () => {
  const p = project()
  realCard(p, 'storage', 'Storage')
  realCard(p, 'cache', 'Cache', 'storage')
  realCard(p, 'index', 'Index', 'storage')
  realCard(p, 'eviction', 'Eviction', 'cache')
  const before = lines(p)
  ok(p, ['remove', 'cache', '--actor', 'you'])
  expect(show(p, 'cache').stdout).toContain('removed')
  expect(show(p, 'eviction').stdout).toContain('removed')
  const kids = childrenInMap(p, 'storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(p, ['removed']).stdout).toContain('#cache')
  const after = lines(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
})

test('66.2 a person restores a removed card and its subtree with their links', () => {
  const p = project()
  realCard(p, 'storage', 'Storage')
  realCard(p, 'cache', 'Cache', 'storage')
  realCard(p, 'eviction', 'Eviction', 'cache')
  realCard(p, 'budget', 'Memory budget')
  ok(p, ['link', 'cache', 'budget', '--type', 'depends_on'])
  ok(p, ['remove', 'cache', '--actor', 'you'])
  ok(p, ['restore', 'cache'])
  const s = show(p, 'cache').stdout
  expect(s).not.toContain('removed')
  expect(childrenInMap(p, 'storage')).toContain('cache')
  expect(childrenInMap(p, 'cache')).toContain('eviction')
  expect(s).toContain('link: depends_on -> #budget')
  expect(ok(p, ['removed']).stdout).not.toContain('#cache')
})

test('66.3 an agent removes a bad parent but keeps its good children', () => {
  const p = project()
  realCard(p, 'storage', 'Storage')
  realCard(p, 'bad', 'Bad layer', 'storage')
  realCard(p, 'write', 'Write path', 'bad')
  realCard(p, 'read', 'Read path', 'bad')
  ok(p, ['remove', 'bad', '--actor', 'you', '--reparent'])
  expect(show(p, 'bad').stdout).toContain('removed')
  const kids = childrenInMap(p, 'storage')
  expect(kids).toContain('write')
  expect(kids).toContain('read')
  expect(show(p, 'write').stdout).not.toContain('removed')
  expect(show(p, 'read').stdout).not.toContain('removed')
})

const found = (p: Project, root: string) =>
  ok(p, ['find', root])
    .stdout.split('\n')
    .flatMap((l) => /#(\S+)/.exec(l)?.[1] ?? [])

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  const p = project()
  decidedCard(p, 'later', { title: 'Later thing' })
  decidedCard(p, 'wrong', { title: 'Wrong thing' })
  realCard(p, 'storage', 'Storage')
  openCard(p, 'cache', 'Cache', 'storage')
  openCard(p, 'index', 'Index', 'storage')
  openCard(p, 'backup', 'Backup', 'storage')
  openCard(p, 'quota', 'Quota', 'storage')
  ok(p, ['link', 'backup', 'later', '--type', 'depends_on'])
  ok(p, ['link', 'quota', 'wrong', '--type', 'depends_on'])
  ok(p, ['reopen', 'later', '--reason', 'postponed', '--why', 'next quarter'])
  ok(p, ['reopen', 'wrong', '--reason', 'rejected', '--why', 'it is wrong'])
  openCard(p, 'outside', 'Outside card')
  const stale = ok(p, ['stale']).stdout
  expect(stale).toMatch(/paused\s+#backup/)
  expect(stale).toMatch(/stale\s+#quota/)
  const ids = found(p, 'storage')
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('outside')
})

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  const p = project()
  realCard(p, 'storage', 'Storage')
  openCard(p, 'cache', 'Cache', 'storage')
  openCard(p, 'index', 'Index', 'storage')
  ok(p, ['remove', 'cache', '--actor', 'you'])
  const first = found(p, 'storage')
  expect(first).toContain('index')
  expect(first).not.toContain('cache')
  ok(p, ['restore', 'cache'])
  const second = found(p, 'storage')
  expect(second).toContain('index')
  expect(second).toContain('cache')
})
