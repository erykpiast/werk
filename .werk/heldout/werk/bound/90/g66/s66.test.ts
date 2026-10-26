/** Held-out steps 66.1–66.5: remove, restore, removed, find. */
import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { linked } from '../../src/test/map-events.ts'
import { card, logLines, ok, projectWith } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The ids that show lists as refines children of a card ("link: refines <- #child"). */
const childrenOf = (id: string) => [...ok(p, ['show', id]).matchAll(/link: refines <- #(\S+)/g)].map((m) => m[1])

test('66.1 an agent removes a bad branch and the log keeps its history', () => {
  p = projectWith([
    ...card('storage', 'Storage', 'open'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('index', 'Index', 'open', 'storage'),
    ...card('eviction', 'Eviction', 'open', 'cache'),
  ])
  expect(childrenOf('storage').toSorted()).toEqual(['cache', 'index'])
  const before = logLines(p)

  ok(p, ['remove', 'cache', '--actor', 'you'])

  expect(ok(p, ['show', 'cache'])).toContain('state: removed')
  expect(ok(p, ['show', 'eviction'])).toContain('state: removed')
  const kids = childrenOf('storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(p, ['removed'])).toContain('#cache  Cache')
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 a person restores a removed card and its subtree with their links', () => {
  p = projectWith([
    ...card('storage', 'Storage', 'open'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('eviction', 'Eviction', 'open', 'cache'),
    ...card('memory-budget', 'Memory budget', 'open'),
    linked('cache', 'memory-budget', 'depends_on', 'needs a budget'),
  ])
  ok(p, ['remove', 'cache', '--actor', 'you'])

  ok(p, ['restore', 'cache'])

  const shown = ok(p, ['show', 'cache'])
  expect(shown).not.toContain('removed')
  expect(childrenOf('storage')).toContain('cache')
  expect(childrenOf('cache')).toContain('eviction')
  expect(ok(p, ['show', 'eviction'])).toContain('parent: #cache')
  expect(shown).toMatch(/link: depends_on -> #memory-budget/)
  expect(ok(p, ['removed'])).not.toContain('#cache')
})

test('66.3 an agent removes a bad parent but keeps its good children', () => {
  p = projectWith([
    ...card('storage', 'Storage', 'open'),
    ...card('bad-layer', 'Bad layer', 'open', 'storage'),
    ...card('write-path', 'Write path', 'open', 'bad-layer'),
    ...card('read-path', 'Read path', 'open', 'bad-layer'),
  ])

  ok(p, ['remove', 'bad-layer', '--actor', 'you', '--reparent'])

  expect(ok(p, ['show', 'bad-layer'])).toContain('state: removed')
  expect(childrenOf('storage').toSorted()).toEqual(['read-path', 'write-path'])
  for (const id of ['write-path', 'read-path']) {
    const shown = ok(p, ['show', id])
    expect(shown).not.toContain('removed')
    expect(shown).toContain('parent: #storage')
  }
})

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  p = projectWith([
    ...card('storage', 'Storage', 'open'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('index', 'Index', 'open', 'storage'),
    ...card('backup', 'Backup', 'open', 'storage'),
    ...card('quota', 'Quota', 'open', 'storage'),
    ...card('later', 'Later', 'decided'),
    ...card('wrong', 'Wrong', 'decided'),
    ...card('outside', 'Outside', 'open'),
    linked('backup', 'later', 'depends_on'),
    linked('quota', 'wrong', 'depends_on'),
  ])
  ok(p, ['reopen', 'later', '--reason', 'postponed', '--why', 'next quarter'])
  ok(p, ['reopen', 'wrong', '--reason', 'rejected', '--why', 'the choice is wrong'])
  const stale = ok(p, ['stale'])
  expect(stale).toContain('#backup')
  expect(stale).toContain('#quota')

  const found = ok(p, ['find', 'storage'])

  expect(found).toContain('#cache')
  expect(found).toContain('#index')
  expect(found).not.toContain('#backup')
  expect(found).not.toContain('#quota')
  expect(found).not.toContain('#outside')
})

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  p = projectWith([
    ...card('storage', 'Storage', 'open'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('index', 'Index', 'open', 'storage'),
  ])
  ok(p, ['remove', 'cache', '--actor', 'you'])

  let found = ok(p, ['find', 'storage'])
  expect(found).toContain('#index')
  expect(found).not.toContain('#cache')

  ok(p, ['restore', 'cache'])
  found = ok(p, ['find', 'storage'])
  expect(found).toContain('#cache')
  expect(found).toContain('#index')
})
