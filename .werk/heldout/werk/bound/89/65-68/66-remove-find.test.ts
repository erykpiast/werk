/**
 * Reading: "under X in the map" = `werk show X` lists the child as `link: refines <- #child`.
 * "the agent removes" = `werk remove <id> --actor you`: the CLI accepts a remove only with the
 * person's claim, which an agent passes when the person asked for the removal.
 * "the agent finds the open cards in the subtree" = `werk find <root> --status open`.
 */
import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const children = (id: string) => [...p.ok(['show', id]).matchAll(/^link: refines <- #(\S+)/gm)].map((m) => m[1])
const listed = (out: string) => [...out.matchAll(/^\S+\s+#(\S+)/gm)].map((m) => m[1])

// 66.1
// Scenario: An agent removes a bad branch and the log keeps its history
// Given a map with a card "Storage" that has two child cards, "Cache" and "Index"
// And "Cache" has its own child card "Eviction"
// And the agent notes how many events the log holds
// When the agent removes "Cache"
// Then showing "Cache" reports it as removed
// And showing "Eviction" reports it as removed
// And "Cache" and "Eviction" no longer appear under "Storage" in the map
// But "Index" still appears under "Storage"
// And the list of removed cards shows "Cache"
// And the log still holds every event it held before the remove, plus one new event
test('66.1', () => {
  p = project()
  p.card('storage', 'Storage')
  p.card('cache', 'Cache', 'storage')
  p.card('index', 'Index', 'storage')
  p.card('eviction', 'Eviction', 'cache')
  const before = p.events()

  p.ok(['remove', 'cache', '--actor', 'you'])

  expect(p.ok(['show', 'cache'])).toMatch(/^state: removed/m)
  expect(p.ok(['show', 'eviction'])).toMatch(/^state: removed/m)
  const kids = children('storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(p.ok(['removed'])).toContain('#cache')
  const after = p.events()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
})

// 66.2
// Scenario: A person restores a removed card and its subtree with their links
// Given a map with a card "Storage" that has a child card "Cache"
// And "Cache" has a child card "Eviction"
// And "Cache" depends on a card "Memory budget"
// And the agent removes "Cache"
// When the agent restores "Cache"
// Then showing "Cache" no longer reports it as removed
// And "Cache" appears under "Storage" in the map again
// And "Eviction" appears under "Cache" again
// And showing "Cache" lists its dependency on "Memory budget"
// And the list of removed cards no longer shows "Cache"
test('66.2', () => {
  p = project()
  p.card('storage', 'Storage')
  p.card('cache', 'Cache', 'storage')
  p.card('eviction', 'Eviction', 'cache')
  p.card('memory-budget', 'Memory budget')
  p.ok(['link', 'cache', 'memory-budget', '--type', 'depends_on', '--why', 'the cache fits the budget'])
  p.ok(['remove', 'cache', '--actor', 'you'])

  p.ok(['restore', 'cache'])

  const show = p.ok(['show', 'cache'])
  expect(show).not.toMatch(/removed/)
  expect(children('storage')).toContain('cache')
  expect(children('cache')).toContain('eviction')
  expect(show).toContain('link: depends_on -> #memory-budget')
  expect(p.ok(['removed'])).not.toContain('#cache')
})

// 66.3
// Scenario: An agent removes a bad parent but keeps its good children
// Given a map with a card "Storage" that has a child card "Bad layer"
// And "Bad layer" has two child cards, "Write path" and "Read path"
// When the agent removes "Bad layer" with the option that lifts its children
// Then showing "Bad layer" reports it as removed
// And "Write path" and "Read path" appear directly under "Storage" in the map
// And showing "Write path" does not report it as removed
// And showing "Read path" does not report it as removed
test('66.3', () => {
  p = project()
  p.card('storage', 'Storage')
  p.card('bad-layer', 'Bad layer', 'storage')
  p.card('write-path', 'Write path', 'bad-layer')
  p.card('read-path', 'Read path', 'bad-layer')

  p.ok(['remove', 'bad-layer', '--actor', 'you', '--reparent'])

  expect(p.ok(['show', 'bad-layer'])).toMatch(/^state: removed/m)
  const kids = children('storage')
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  const w = p.ok(['show', 'write-path'])
  const r = p.ok(['show', 'read-path'])
  expect(w).toContain('parent: #storage')
  expect(r).toContain('parent: #storage')
  expect(w).not.toMatch(/removed/)
  expect(r).not.toMatch(/removed/)
})

// 66.4
// Scenario: An agent finds the open cards it can work on in a subtree
// Given a map with a card "Storage" that has four open child cards: "Cache", "Index", "Backup", and "Quota"
// And "Backup" depends on a card that is reopened with the reason postponed, so "Backup" is paused
// And "Quota" depends on a card that is reopened with the reason rejected, so "Quota" is stale
// And a card outside the "Storage" subtree is open
// When the agent finds the open cards in the "Storage" subtree
// Then the output lists "Cache" and "Index"
// But the output does not list "Backup"
// And the output does not list "Quota"
// And the output does not list the open card outside the subtree
test('66.4', () => {
  p = project()
  p.card('storage', 'Storage')
  for (const [id, title] of [['cache', 'Cache'], ['index', 'Index'], ['backup', 'Backup'], ['quota', 'Quota']]) p.card(id!, title!, 'storage')
  p.card('snapshots', 'Snapshots')
  p.card('replicas', 'Replicas')
  p.card('outside', 'Outside')
  for (const id of ['snapshots', 'replicas']) {
    p.facts(id)
    p.decide(id)
  }
  p.ok(['link', 'backup', 'snapshots', '--type', 'depends_on', '--why', 'backup copies snapshots'])
  p.ok(['link', 'quota', 'replicas', '--type', 'depends_on', '--why', 'quota counts replicas'])
  p.ok(['reopen', 'snapshots', '--reason', 'postponed', '--why', 'later'])
  p.ok(['reopen', 'replicas', '--reason', 'rejected', '--why', 'wrong'])
  const marks = p.staleEntries()
  expect(marks.find((e) => e.id === 'backup')?.mark).toBe('paused')
  expect(marks.find((e) => e.id === 'quota')?.mark).toBe('stale')
  for (const id of ['cache', 'index', 'backup', 'quota', 'outside']) expect(p.ok(['show', id])).toContain('status: open')

  const ids = listed(p.ok(['find', 'storage', '--status', 'open']))
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('outside')
})

// 66.5
// Scenario: A removed branch drops out of the find result and comes back after a restore
// Given a map with a card "Storage" that has two open child cards, "Cache" and "Index"
// And the agent removes "Cache"
// When the agent finds the open cards in the "Storage" subtree
// Then the output lists "Index"
// But the output does not list "Cache"
// When the agent restores "Cache"
// And the agent finds the open cards in the "Storage" subtree again
// Then the output lists both "Cache" and "Index"
test('66.5', () => {
  p = project()
  p.card('storage', 'Storage')
  p.card('cache', 'Cache', 'storage')
  p.card('index', 'Index', 'storage')
  p.ok(['remove', 'cache', '--actor', 'you'])

  let ids = listed(p.ok(['find', 'storage', '--status', 'open']))
  expect(ids).toContain('index')
  expect(ids).not.toContain('cache')

  p.ok(['restore', 'cache'])
  ids = listed(p.ok(['find', 'storage', '--status', 'open']))
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
})
