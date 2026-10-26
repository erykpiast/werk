import { expect, test } from 'bun:test'
import { card, childrenInMap, decided, dependsOn, logLines, mapOf, projectWith, werkOk } from './h65-68-lib.ts'
import type { Project } from '../src/test/harness.ts'

const show = (p: Project, id: string) => p.werk(['show', id])
const isRemoved = (p: Project, id: string) => /^state: removed/m.test(show(p, id).stdout)
const findIds = (p: Project, root: string) => [...werkOk(p, ['find', root]).matchAll(/#(\S+)/g)].map((m) => m[1]!)

// Note: the remove verb takes the person's claim; the agent passes --actor you, as its usage says.

// Scenario: An agent removes a bad branch and the log keeps its history
test('66.1 an agent removes a bad branch and the log keeps its history', async () => {
  // Given Storage with Cache and Index / And Cache has Eviction
  const p = projectWith([
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', { parent: 'storage' }),
    ...card('index', 'Index', { parent: 'storage' }),
    ...card('eviction', 'Eviction', { parent: 'cache' }),
  ])
  // And the agent notes how many events the log holds
  const before = logLines(p)
  // When the agent removes "Cache"
  werkOk(p, ['remove', 'cache', '--actor', 'you'])
  // Then showing "Cache" reports it as removed / And showing "Eviction" reports it as removed
  expect(isRemoved(p, 'cache')).toBe(true)
  expect(isRemoved(p, 'eviction')).toBe(true)
  // And Cache and Eviction no longer appear under Storage in the map / But Index still appears
  const g = await mapOf(p)
  const under = childrenInMap(g, 'storage')
  expect(under).not.toContain('cache')
  expect(g.nodes.map((n) => n.id)).not.toContain('eviction')
  expect(under).toContain('index')
  // And the list of removed cards shows "Cache"
  expect(werkOk(p, ['removed'])).toContain('#cache')
  // And the log still holds every event it held before the remove, plus one new event
  const after = logLines(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
})

// Scenario: A person restores a removed card and its subtree with their links
test('66.2 a person restores a removed card and its subtree with their links', async () => {
  const p = projectWith([
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', { parent: 'storage' }),
    ...card('eviction', 'Eviction', { parent: 'cache' }),
    ...card('memory-budget', 'Memory budget'),
    dependsOn('cache', 'memory-budget'),
  ])
  // And the agent removes "Cache"
  werkOk(p, ['remove', 'cache', '--actor', 'you'])
  // When the agent restores "Cache"
  werkOk(p, ['restore', 'cache'])
  // Then showing "Cache" no longer reports it as removed
  const out = show(p, 'cache')
  expect(out.code).toBe(0)
  expect(out.stdout).not.toMatch(/^state: removed/m)
  // And Cache appears under Storage again / And Eviction appears under Cache again
  const g = await mapOf(p)
  expect(childrenInMap(g, 'storage')).toContain('cache')
  expect(childrenInMap(g, 'cache')).toContain('eviction')
  // And showing "Cache" lists its dependency on "Memory budget"
  expect(out.stdout).toMatch(/link: depends_on -> #memory-budget/)
  // And the list of removed cards no longer shows "Cache"
  expect(werkOk(p, ['removed'])).not.toContain('#cache')
})

// Scenario: An agent removes a bad parent but keeps its good children
test('66.3 an agent removes a bad parent but keeps its good children', async () => {
  const p = projectWith([
    ...card('storage', 'Storage'),
    ...card('bad-layer', 'Bad layer', { parent: 'storage' }),
    ...card('write-path', 'Write path', { parent: 'bad-layer' }),
    ...card('read-path', 'Read path', { parent: 'bad-layer' }),
  ])
  // When the agent removes "Bad layer" with the option that lifts its children
  werkOk(p, ['remove', 'bad-layer', '--actor', 'you', '--reparent'])
  // Then showing "Bad layer" reports it as removed
  expect(isRemoved(p, 'bad-layer')).toBe(true)
  // And Write path and Read path appear directly under Storage in the map
  const under = childrenInMap(await mapOf(p), 'storage')
  expect(under).toContain('write-path')
  expect(under).toContain('read-path')
  // And showing Write path / Read path does not report it as removed
  expect(show(p, 'write-path').code).toBe(0)
  expect(isRemoved(p, 'write-path')).toBe(false)
  expect(show(p, 'read-path').code).toBe(0)
  expect(isRemoved(p, 'read-path')).toBe(false)
})

// Scenario: An agent finds the open cards it can work on in a subtree
test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  const p = projectWith([
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', { parent: 'storage' }),
    ...card('index', 'Index', { parent: 'storage' }),
    ...card('backup', 'Backup', { parent: 'storage' }),
    ...card('quota', 'Quota', { parent: 'storage' }),
    ...decided('vendor', 'Vendor'),
    ...decided('limits', 'Limits'),
    dependsOn('backup', 'vendor'),
    dependsOn('quota', 'limits'),
    ...card('outside', 'Outside card'),
  ])
  // And Backup depends on a card that is reopened with the reason postponed
  werkOk(p, ['reopen', 'vendor', '--reason', 'postponed', '--why', 'vendor waits'])
  // And Quota depends on a card that is reopened with the reason rejected
  werkOk(p, ['reopen', 'limits', '--reason', 'rejected', '--why', 'limits are wrong'])
  // When the agent finds the open cards in the Storage subtree
  const ids = findIds(p, 'storage')
  // Then Cache and Index / not Backup / not Quota / not outside
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('outside')
})

// Scenario: A removed branch drops out of the find result and comes back after a restore
test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  const p = projectWith([...card('storage', 'Storage'), ...card('cache', 'Cache', { parent: 'storage' }), ...card('index', 'Index', { parent: 'storage' })])
  // And the agent removes "Cache"
  werkOk(p, ['remove', 'cache', '--actor', 'you'])
  // When the agent finds the open cards in the Storage subtree
  let ids = findIds(p, 'storage')
  expect(ids).toContain('index')
  expect(ids).not.toContain('cache')
  // When the agent restores Cache / And finds again
  werkOk(p, ['restore', 'cache'])
  ids = findIds(p, 'storage')
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
})
