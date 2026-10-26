import { expect, test } from 'bun:test'
import { refinesTree, type TreeNode } from '../../src/map/graph.ts'
import { linked } from '../../src/test/map-events.ts'
import type { Project } from '../../src/test/harness.ts'
import { card, logLines, mapGraph, ok, seeded, SLOW } from './util.ts'

const childrenOf = async (p: Project, id: string): Promise<string[]> => {
  const find = (nodes: TreeNode[]): TreeNode | undefined => {
    for (const n of nodes) {
      if (n.node.id === id) return n
      const hit = find(n.children)
      if (hit) return hit
    }
  }
  const hit = find(refinesTree(await mapGraph(p)))
  return hit ? hit.children.map((c) => c.node.id) : []
}

test('66.1 an agent removes a bad branch and the log keeps its history', async () => {
  const p = seeded(...card('storage', 'open', undefined, 'Storage'), ...card('cache', 'open', 'storage', 'Cache'), ...card('index', 'open', 'storage', 'Index'), ...card('eviction', 'open', 'cache', 'Eviction'))
  const before = logLines(p)
  ok(p, ['remove', 'cache', '--actor', 'you'])
  expect(ok(p, ['show', 'cache'])).toContain('state: removed')
  expect(ok(p, ['show', 'eviction'])).toContain('state: removed')
  const kids = await childrenOf(p, 'storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(p, ['removed'])).toContain('#cache')
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
}, SLOW)

test('66.2 a restore brings back a removed card and its subtree with their links', async () => {
  const p = seeded(
    ...card('storage', 'open', undefined, 'Storage'), ...card('cache', 'open', 'storage', 'Cache'), ...card('eviction', 'open', 'cache', 'Eviction'),
    ...card('memory-budget', 'open', undefined, 'Memory budget'), linked('cache', 'memory-budget', 'depends_on'),
  )
  ok(p, ['remove', 'cache', '--actor', 'you'])
  ok(p, ['restore', 'cache'])
  const shown = ok(p, ['show', 'cache'])
  expect(shown).not.toContain('removed')
  expect(await childrenOf(p, 'storage')).toContain('cache')
  expect(await childrenOf(p, 'cache')).toContain('eviction')
  expect(shown).toContain('link: depends_on -> #memory-budget')
  expect(ok(p, ['removed'])).not.toContain('#cache')
}, SLOW)

test('66.3 an agent removes a bad parent but keeps its good children', async () => {
  const p = seeded(...card('storage', 'open', undefined, 'Storage'), ...card('bad-layer', 'open', 'storage', 'Bad layer'), ...card('write-path', 'open', 'bad-layer', 'Write path'), ...card('read-path', 'open', 'bad-layer', 'Read path'))
  ok(p, ['remove', 'bad-layer', '--actor', 'you', '--reparent'])
  expect(ok(p, ['show', 'bad-layer'])).toContain('state: removed')
  const kids = await childrenOf(p, 'storage')
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  expect(ok(p, ['show', 'write-path'])).not.toContain('removed')
  expect(ok(p, ['show', 'read-path'])).not.toContain('removed')
}, SLOW)

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  const p = seeded(
    ...card('storage', 'decided', undefined, 'Storage'),
    ...card('cache', 'open', 'storage', 'Cache'), ...card('index', 'open', 'storage', 'Index'),
    ...card('backup', 'open', 'storage', 'Backup'), ...card('quota', 'open', 'storage', 'Quota'),
    ...card('later', 'decided', undefined, 'Later'), ...card('wrong', 'decided', undefined, 'Wrong'),
    ...card('outside', 'open', undefined, 'Outside'),
    linked('backup', 'later', 'depends_on'), linked('quota', 'wrong', 'depends_on'),
  )
  ok(p, ['reopen', 'later', '--reason', 'postponed', '--why', 'not now'])
  ok(p, ['reopen', 'wrong', '--reason', 'rejected', '--why', 'wrong'])
  const out = ok(p, ['find', 'storage'])
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
  expect(out).not.toContain('#backup')
  expect(out).not.toContain('#quota')
  expect(out).not.toContain('#outside')
}, SLOW)

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  const p = seeded(...card('storage', 'decided', undefined, 'Storage'), ...card('cache', 'open', 'storage', 'Cache'), ...card('index', 'open', 'storage', 'Index'))
  ok(p, ['remove', 'cache', '--actor', 'you'])
  let out = ok(p, ['find', 'storage'])
  expect(out).toContain('#index')
  expect(out).not.toContain('#cache')
  ok(p, ['restore', 'cache'])
  out = ok(p, ['find', 'storage'])
  expect(out).toContain('#index')
  expect(out).toContain('#cache')
}, SLOW)
