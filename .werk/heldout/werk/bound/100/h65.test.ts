import { expect, test } from 'bun:test'
import { decided, dependsOn, mapOf, projectWith, werkOk } from './h65-68-lib.ts'
import type { Project } from '../src/test/harness.ts'

/** The stale list as entries: the mark, the card id, and the trace lines under it. */
function staleList(p: Project) {
  const out = werkOk(p, ['stale'])
  const entries: { mark: string; id: string; traces: string[] }[] = []
  for (const line of out.split('\n')) {
    const head = /^(stale|paused)\s+#(\S+)/.exec(line)
    if (head) entries.push({ mark: head[1]!, id: head[2]!, traces: [] })
    else if (line.startsWith('  ') && entries.length) entries.at(-1)!.traces.push(line)
  }
  return entries
}

// Scenario: A rejected reopen marks only the next hop as stale
test('65.1 a rejected reopen marks only the next hop as stale', async () => {
  // Given a map with three decided cards A, B and C / And B depends on A / And C depends on B
  const p = projectWith([...decided('a', 'Card A'), ...decided('b', 'Card B'), ...decided('c', 'Card C'), dependsOn('b', 'a'), dependsOn('c', 'b')])
  // When the user reopens card A with the reason rejected and the sentence "the storage choice is wrong"
  werkOk(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const list = staleList(p)
  // Then the stale list shows card B as stale
  const b = list.find((e) => e.id === 'b')
  expect(b?.mark).toBe('stale')
  // And the entry for card B names card A as the cause, the depends_on link, and the reason rejected
  expect(b!.traces.join('\n')).toContain('#a')
  expect(b!.traces.join('\n')).toContain('depends_on')
  expect(b!.traces.join('\n')).toContain('rejected')
  // And card C does not appear in the stale list
  expect(list.find((e) => e.id === 'c')).toBeUndefined()
  // And card C shows no stale mark and no paused mark on the map
  const g = await mapOf(p)
  expect(g.marks.c).toBeUndefined()
})

// Scenario: A postponed reopen pauses every downstream card and keeps their status
test('65.2 a postponed reopen pauses every downstream card and keeps their status', async () => {
  // Given four cards A, B, C, D; B on A, C on B, D on C; D decided
  const p = projectWith([
    ...decided('a', 'Card A'),
    ...decided('b', 'Card B'),
    ...decided('c', 'Card C'),
    ...decided('d', 'Card D'),
    dependsOn('b', 'a'),
    dependsOn('c', 'b'),
    dependsOn('d', 'c'),
  ])
  // When the user reopens card A with the reason postponed and the sentence "the engine build waits for next quarter"
  werkOk(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const g = await mapOf(p)
  // Then cards B, C and D each show the paused mark
  for (const id of ['b', 'c', 'd']) expect(g.marks[id]?.mark).toBe('paused')
  // And card D still shows the status decided
  expect(g.nodes.find((n) => n.id === 'd')?.status).toBe('decided')
  // And the stale list shows card D as paused, with card A as the cause and the reason postponed
  const d = staleList(p).find((e) => e.id === 'd')
  expect(d?.mark).toBe('paused')
  expect(d!.traces.join('\n')).toContain('#a')
  expect(d!.traces.join('\n')).toContain('postponed')
  // But no card shows the stale mark
  expect(Object.values(g.marks).filter((m) => m.mark === 'stale')).toEqual([])
})

// Scenario: Stale wins when a postponement and a rejection reach the same card
test('65.3 stale wins when a postponement and a rejection reach the same card', async () => {
  // Given decided cards A, B and C / And C depends on A / And C also refines B
  const p = projectWith([...decided('a', 'Card A'), ...decided('b', 'Card B'), ...decided('c', 'Card C', { parent: 'b' }), dependsOn('c', 'a')])
  // When the user reopens card A with the reason postponed / And reopens card B with the reason rejected
  werkOk(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'a waits'])
  werkOk(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'b is wrong'])
  // Then card C shows as stale, not as paused
  const g = await mapOf(p)
  expect(g.marks.c?.mark).toBe('stale')
  // And the stale list shows card C with card B as the cause and the reason rejected
  const c = staleList(p).find((e) => e.id === 'c')
  expect(c?.mark).toBe('stale')
  expect(c!.traces.some((t) => t.includes('rejected') && t.includes('#b'))).toBe(true)
})

// Scenario: Rederive clears the mark on one card and leaves the others
test('65.4 rederive clears the mark on one card and leaves the others', async () => {
  // Given a decided card A with two direct dependents, cards B and C
  const p = projectWith([...decided('a', 'Card A'), ...decided('b', 'Card B'), ...decided('c', 'Card C'), dependsOn('b', 'a'), dependsOn('c', 'a')])
  // And the user reopened card A with the reason rejected
  werkOk(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'a is wrong'])
  // And the stale list shows both card B and card C as stale
  expect(staleList(p).filter((e) => e.mark === 'stale').map((e) => e.id).sort()).toEqual(['b', 'c'])
  // When the user rederives card B and confirms it
  werkOk(p, ['rederive', 'b', 'confirm', '--why', 'b still holds'])
  const list = staleList(p)
  // Then the stale list no longer shows card B
  expect(list.find((e) => e.id === 'b')).toBeUndefined()
  // And the stale list still shows card C as stale, with card A as the cause and the reason rejected
  const c = list.find((e) => e.id === 'c')
  expect(c?.mark).toBe('stale')
  expect(c!.traces.some((t) => t.includes('rejected') && t.includes('#a'))).toBe(true)
  // And card B shows no stale mark on the map
  expect((await mapOf(p)).marks.b).toBeUndefined()
})

// Scenario: Deciding a postponed card again clears the paused marks downstream
test('65.5 deciding a postponed card again clears the paused marks downstream', async () => {
  // Given B depends on A, and C depends on B
  const p = projectWith([...decided('a', 'Card A'), ...decided('b', 'Card B'), ...decided('c', 'Card C'), dependsOn('b', 'a'), dependsOn('c', 'b')])
  const statusBefore = (await mapOf(p)).nodes.find((n) => n.id === 'c')?.status
  // And the user reopened card A with the reason postponed
  werkOk(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'a waits'])
  // And cards B and C show the paused mark
  const g1 = await mapOf(p)
  expect(g1.marks.b?.mark).toBe('paused')
  expect(g1.marks.c?.mark).toBe('paused')
  // When the user decides card A again
  werkOk(p, ['status', 'a', 'decided'])
  const g2 = await mapOf(p)
  // Then cards B and C no longer show the paused mark
  expect(g2.marks.b).toBeUndefined()
  expect(g2.marks.c).toBeUndefined()
  // And the stale list shows neither card B nor card C
  const ids = staleList(p).map((e) => e.id)
  expect(ids).not.toContain('b')
  expect(ids).not.toContain('c')
  // And card C still shows the status it had before the reopen
  expect(g2.nodes.find((n) => n.id === 'c')?.status).toBe(statusBefore)
})
