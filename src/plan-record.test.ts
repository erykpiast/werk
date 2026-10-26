import { describe, expect, test } from 'bun:test'
import { fold } from './fold.ts'
import { planCopy, scopeEntries } from './plan-record.ts'
import type { Event } from './types.ts'

let seq = 0
const ev = (type: string, payload: object): Event => ({ seq: ++seq, at: '2026-10-24T10:00:00.000Z', actor: 'agent', type: type as Event['type'], payload })

describe('scopeEntries (#ms-store-scope)', () => {
  test('each card gets its tier and the last log position of what the planner reads of it', () => {
    seq = 0
    const events = [
      ev('node.added', { id: 'app', kind: 'card', title: 'The app', status: 'decided' }), // 1
      ev('node.added', { id: 'mail', kind: 'card', title: 'Mail', status: 'decided' }), // 2
      ev('node.added', { id: 'mail:opt0', kind: 'option', title: 'Two providers', why_not: 'cost' }), // 3
      ev('edge.added', { from: 'mail:opt0', to: 'mail', type: 'alternative_to' }), // 4
      ev('node.added', { id: 'src', kind: 'source', title: 'A study' }), // 5
      ev('edge.added', { from: 'app', to: 'src', type: 'supported_by' }), // 6
      ev('note.added', { node: 'app', from: 'you', text: 'later' }), // 7: a note is not shown
      ev('kill.added', { id: 'mail', criterion: {} }), // 8: nor is a kill criterion
      ev('node.retitled', { id: 'mail:opt0', title: 'Two mail providers' }), // 9
    ]
    const g = fold(events)
    const entries = scopeEntries(g, events, [g.nodes.get('app')!], [g.nodes.get('mail')!])
    expect(entries).toEqual([
      { id: 'app', tier: 1, seq: 6 },
      { id: 'mail', tier: 2, seq: 9 },
    ])
  })

  test('a card with no event of its own is at position 0', () => {
    const g = fold([ev('node.added', { id: 'app', kind: 'card', title: 'The app' })])
    expect(scopeEntries(g, [], [g.nodes.get('app')!], [])).toEqual([{ id: 'app', tier: 1, seq: 0 }])
  })
})

describe('planCopy (#ms-store-plancopy)', () => {
  const before = { spec: 'spec v1', open: new Map([[2, 'two'], [3, 'three'], [5, 'five']]), known: new Set([1, 2, 3, 4, 5]) }

  test('marks the spec and each open or new ticket as changed, kept, new or archived', () => {
    const after = { spec: 'spec v2', tickets: new Map([[1, 'done one'], [2, 'two, rewritten'], [3, 'three'], [5, 'five'], [6, 'six']]) }
    expect(planCopy(before, after, new Set([5]))).toEqual({ spec: 'changed', tickets: { '02': 'changed', '03': 'kept', '05': 'archived', '06': 'new' } })
  })

  test('an open ticket whose file is gone is archived, and an unchanged spec is kept', () => {
    const after = { spec: 'spec v1', tickets: new Map([[3, 'three'], [5, 'five']]) }
    expect(planCopy(before, after, new Set())).toEqual({ spec: 'kept', tickets: { '02': 'archived', '03': 'kept', '05': 'kept' } })
  })

  test('a first plan has a new spec; a plan that wrote none has no spec', () => {
    const empty = { spec: '', open: new Map<number, string>(), known: new Set<number>() }
    expect(planCopy(empty, { spec: 's', tickets: new Map([[1, 'one']]) }, new Set())).toEqual({ spec: 'new', tickets: { '01': 'new' } })
    expect(planCopy(empty, { spec: '', tickets: new Map() }, new Set())).toEqual({ spec: 'none', tickets: {} })
  })
})
