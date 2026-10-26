/**
 * Reading of "on the map" for the CLI: a card shows the stale / paused mark when `werk stale`
 * lists it with that mark word. `werk show` prints no mark line, so a card with no mark is a
 * card that `werk stale` does not list, and whose `show` output names no mark.
 */
import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const entry = (id: string) => p.staleEntries().find((e) => e.id === id)

// 65.1
// Scenario: A rejected reopen marks only the next hop as stale
// Given a map with three decided cards A, B and C
// And card B depends on card A
// And card C depends on card B
// When the user reopens card A with the reason rejected and the sentence "the storage choice is wrong"
// Then the stale list shows card B as stale
// And the entry for card B names card A as the cause, the depends_on link, and the reason rejected
// And card C does not appear in the stale list
// And card C shows no stale mark and no paused mark on the map
test('65.1', () => {
  p = project()
  for (const id of ['a', 'b', 'c']) {
    p.card(id)
    p.facts(id)
  }
  p.ok(['link', 'b', 'a', '--type', 'depends_on', '--why', 'b uses a'])
  p.ok(['link', 'c', 'b', '--type', 'depends_on', '--why', 'c uses b'])
  for (const id of ['a', 'b', 'c']) p.decide(id)

  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])

  const b = entry('b')
  expect(b?.mark).toBe('stale')
  const cause = b!.lines.slice(1).join('\n')
  expect(cause).toContain('#a')
  expect(cause).toContain('depends_on')
  expect(cause).toContain('rejected')
  expect(entry('c')).toBeUndefined()
  expect(p.ok(['stale'])).not.toContain('#c')
  const showC = p.ok(['show', 'c'])
  expect(showC).not.toMatch(/stale|paused/)
})

// 65.2
// Scenario: A postponed reopen pauses every downstream card and keeps their status
// Given a map with four cards A, B, C and D
// And card B depends on card A, card C depends on card B, and card D depends on card C
// And card D has the status decided
// When the user reopens card A with the reason postponed and the sentence "the engine build waits for next quarter"
// Then cards B, C and D each show the paused mark
// And card D still shows the status decided
// And the stale list shows card D as paused, with card A as the cause and the reason postponed
// But no card shows the stale mark
test('65.2', () => {
  p = project()
  for (const id of ['a', 'b', 'c', 'd']) {
    p.card(id)
    p.facts(id)
  }
  p.ok(['link', 'b', 'a', '--type', 'depends_on', '--why', 'b uses a'])
  p.ok(['link', 'c', 'b', '--type', 'depends_on', '--why', 'c uses b'])
  p.ok(['link', 'd', 'c', '--type', 'depends_on', '--why', 'd uses c'])
  // A must be decided to be reopened; B and C are decided too (the step leaves their status open).
  for (const id of ['a', 'b', 'c', 'd']) p.decide(id)

  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])

  for (const id of ['b', 'c', 'd']) expect({ id, mark: entry(id)?.mark }).toEqual({ id, mark: 'paused' })
  expect(p.ok(['show', 'd'])).toContain('status: decided')
  const cause = entry('d')!.lines.slice(1).join('\n')
  expect(cause).toContain('#a')
  expect(cause).toContain('postponed')
  expect(p.staleEntries().filter((e) => e.mark === 'stale')).toEqual([])
})

// 65.3
// Scenario: Stale wins when a postponement and a rejection reach the same card
// Given a map with decided cards A, B and C
// And card C depends on card A
// And card C also refines card B
// When the user reopens card A with the reason postponed
// And the user reopens card B with the reason rejected
// Then card C shows as stale, not as paused
// And the stale list shows card C with card B as the cause and the reason rejected
test('65.3', () => {
  p = project()
  p.card('a')
  p.card('b')
  p.card('c', 'Card c', 'b')
  for (const id of ['a', 'b', 'c']) p.facts(id)
  p.ok(['link', 'c', 'a', '--type', 'depends_on', '--why', 'c uses a'])
  for (const id of ['a', 'b', 'c']) p.decide(id)

  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  p.ok(['reopen', 'b', '--reason', 'rejected', '--why', 'b is wrong'])

  const c = p.staleEntries().filter((e) => e.id === 'c')
  expect(c.map((e) => e.mark)).toEqual(['stale'])
  const cause = c[0]!.lines.slice(1).join('\n')
  expect(cause).toMatch(/rejected #b/)
})

// 65.4
// Scenario: Rederive clears the mark on one card and leaves the others
// Given a decided card A with two direct dependents, cards B and C
// And the user reopened card A with the reason rejected
// And the stale list shows both card B and card C as stale
// When the user rederives card B and confirms it
// Then the stale list no longer shows card B
// And the stale list still shows card C as stale, with card A as the cause and the reason rejected
// And card B shows no stale mark on the map
test('65.4', () => {
  p = project()
  for (const id of ['a', 'b', 'c']) {
    p.card(id)
    p.facts(id)
  }
  p.ok(['link', 'b', 'a', '--type', 'depends_on', '--why', 'b uses a'])
  p.ok(['link', 'c', 'a', '--type', 'depends_on', '--why', 'c uses a'])
  for (const id of ['a', 'b', 'c']) p.decide(id)
  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'a is wrong'])
  expect(entry('b')?.mark).toBe('stale')
  expect(entry('c')?.mark).toBe('stale')

  p.ok(['rederive', 'b', 'confirm', '--why', 'b holds without a'])

  expect(entry('b')).toBeUndefined()
  const c = entry('c')
  expect(c?.mark).toBe('stale')
  expect(c!.lines.slice(1).join('\n')).toMatch(/rejected #a/)
  expect(p.ok(['stale'])).not.toContain('#b')
  expect(p.ok(['show', 'b'])).not.toContain('stale')
})

// 65.5
// Scenario: Deciding a postponed card again clears the paused marks downstream
// Given a card B that depends on card A, and a card C that depends on card B
// And the user reopened card A with the reason postponed
// And cards B and C show the paused mark
// When the user decides card A again
// Then cards B and C no longer show the paused mark
// And the stale list shows neither card B nor card C
// And card C still shows the status it had before the reopen
test('65.5', () => {
  p = project()
  for (const id of ['a', 'b', 'c']) {
    p.card(id)
    p.facts(id)
  }
  p.ok(['link', 'b', 'a', '--type', 'depends_on', '--why', 'b uses a'])
  p.ok(['link', 'c', 'b', '--type', 'depends_on', '--why', 'c uses b'])
  for (const id of ['a', 'b', 'c']) p.decide(id)
  const statusBefore = p.ok(['show', 'c']).match(/^status: .*$/m)![0]
  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(entry('b')?.mark).toBe('paused')
  expect(entry('c')?.mark).toBe('paused')

  p.ok(['status', 'a', 'decided'])

  expect(entry('b')).toBeUndefined()
  expect(entry('c')).toBeUndefined()
  const out = p.ok(['stale'])
  expect(out).not.toContain('#b')
  expect(out).not.toContain('#c')
  expect(p.ok(['show', 'c']).match(/^status: .*$/m)![0]).toBe(statusBefore)
})
