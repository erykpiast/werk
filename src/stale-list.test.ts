// The list behind `werk stale` (#werk-cli-stale): which cards are marked, of what kind, in
// what order, and with what reason.
import { describe, expect, test } from 'bun:test'
import { fold } from './fold.ts'
import { markList, renderMarks, subtreeOf, waitingCards } from './stale-list.ts'
import type { Event, EventType } from './types.ts'

function log(...events: Array<[EventType, Record<string, unknown>]>): Event[] {
  return events.map(([type, payload], i) => ({
    seq: i + 1,
    at: `2026-09-22T10:${String(i).padStart(2, '0')}:00.000Z`,
    actor: 'agent' as const,
    type,
    payload,
  }))
}
const ev = (type: EventType, payload: Record<string, unknown>) => [type, payload] as [EventType, Record<string, unknown>]
const card = (id: string, status = 'decided') => ev('node.added', { id, kind: 'card', title: `T ${id}`, status })
const dep = (from: string, to: string) => ev('edge.added', { from, to, type: 'depends_on' })
const under = (from: string, to: string) => ev('edge.added', { from, to, type: 'refines' })

// c depends on b depends on a. n is a new open card on b. a is reopened.
const base = [card('root'), card('a'), card('b'), card('c'), card('n', 'open'), under('a', 'root'), under('b', 'root'), under('c', 'b'), under('n', 'b'), dep('b', 'a'), dep('c', 'b'), dep('n', 'b')]

describe('markList', () => {
  test('nothing is marked on a clean map, and the output says so', () => {
    const g = fold(log(card('a'), card('b'), dep('b', 'a')))
    expect(markList(g)).toEqual([])
    expect(renderMarks([])).toEqual(['Nothing is marked.'])
  })

  test('a stale card prints with its trace; a card on a stale basis waits; fix order puts the basis first', () => {
    const g = fold(log(...base, ev('reopened', { id: 'a', reason: 'invalidated', why: 'price changed' })))
    const marks = markList(g)
    expect(marks.map((m) => [m.kind, m.id])).toEqual([
      ['stale', 'b'],
      ['waiting', 'n'],
    ])
    expect(renderMarks(marks)).toEqual([
      'STALE    b  T b',
      '         from #a, invalidated on 2026-09-22 — price changed',
      'WAITING  n  T n',
      '         waits for #b (stale)  T b',
    ])
  })

  test('a paused basis holds, so a card on it does not wait', () => {
    // m links to the paused b after the postponement, so no mark reaches it.
    const g = fold(log(...base, ev('reopened', { id: 'a', reason: 'postponed' }), card('m', 'open'), dep('m', 'b')))
    expect(markList(g).map((m) => [m.kind, m.id])).toEqual([
      ['paused', 'b'],
      ['paused', 'c'],
      ['paused', 'n'],
    ])
    expect(waitingCards(g).has('m')).toBe(false)
  })

  test('a card waits on an open basis, and after any waiting card it depends on', () => {
    const g = fold(log(card('x', 'open'), card('y', 'open'), card('z', 'proto'), dep('z', 'y'), dep('y', 'x')))
    const marks = markList(g)
    expect(marks.map((m) => m.id)).toEqual(['y', 'z'])
    expect(marks[1].waitsFor).toEqual([{ id: 'y', title: 'T y', state: 'open' }])
  })

  test('--kind keeps one kind, and an id keeps that card and its refines subtree', () => {
    const g = fold(log(...base, ev('reopened', { id: 'a' })))
    expect(markList(g, { kind: 'waiting' }).map((m) => m.id)).toEqual(['n'])
    expect(markList(g, { kind: 'paused' })).toEqual([])
    expect(markList(g, { under: 'a' })).toEqual([])
    expect([...subtreeOf(g, 'b')].sort()).toEqual(['b', 'c', 'n'])
  })

  test('a mark with no trace on record still says so', () => {
    expect(renderMarks([{ kind: 'stale', id: 'q', title: 'Q', traces: [], waitsFor: [] }])).toEqual([
      'STALE    q  Q',
      '         from a change with no trace on record',
    ])
  })
})
