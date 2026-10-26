import { describe, expect, test } from 'bun:test'
import type { BoardEvent } from './board.ts'
import { blamedLines, escapes, followUps, greenMerges, reworkedCards, reworkReport, ticketCommitPattern } from './outcomes.ts'
import type { Event } from './types.ts'

let seq = 0
const at = (day: number) => `2026-05-${String(day).padStart(2, '0')}T10:00:00.000Z`
const b = (day: number, type: string, payload: object) => ({ seq: ++seq, at: at(day), actor: 'agent', type, payload }) as BoardEvent
const d = (day: number, type: string, payload: object) => ({ seq: ++seq, at: at(day), actor: 'agent', type, payload }) as Event

describe('followUps (#ms-outcome-followup)', () => {
  test('numbers the records per ticket, and a correction replaces the fields of its record', () => {
    const list = followUps([
      b(1, 'ticket.followup', { id: 'app/01', class: 'build', found: 'after-merge', why: 'expiry', catchable: true }),
      b(2, 'ticket.followup', { id: 'app/02', class: 'plan', found: 'review', why: 'wrong button' }),
      b(3, 'ticket.followup', { id: 'app/01', class: 'plan', found: 'after-merge', why: 'no card said it', catchable: true, of: 1 }),
      b(4, 'ticket.followup', { id: 'app/01', class: 'plan', found: 'review', why: 'stray', of: 7 }),
      b(5, 'ticket.moved', { id: 'app/01', to: 'done' }),
    ])
    expect(list).toEqual([
      { ticket: 'app/01', n: 1, at: at(1), class: 'plan', found: 'after-merge', why: 'no card said it', catchable: undefined, corrected: 1 },
      { ticket: 'app/02', n: 1, at: at(2), class: 'plan', found: 'review', why: 'wrong button', catchable: undefined, corrected: 0 },
    ])
  })
})

describe('escapes (#ms-outcome-escape)', () => {
  test('a red merge check, a red held-out run and a build-miss follow-up, by place; a conflict and a plan miss are not escapes', () => {
    expect(
      escapes([
        b(1, 'ticket.merge', { id: 'app/01', green: false, cmd: 'make test', code: 1 }),
        b(2, 'ticket.merge', { id: 'app/04', green: false, conflict: true }),
        b(3, 'ticket.merge', { id: 'app/02', green: true, commit: 'abc' }),
        b(4, 'ticket.heldout', { id: 'app/02', green: false, failed: ['s1'] }),
        b(5, 'ticket.heldout', { id: 'app/05', green: false, binderErrors: ['s2'] }),
        b(6, 'ticket.followup', { id: 'app/03', class: 'build', found: 'after-merge', why: 'x', catchable: false }),
        b(7, 'ticket.followup', { id: 'app/06', class: 'plan', found: 'review', why: 'y' }),
      ]),
    ).toEqual([
      { ticket: 'app/01', place: 'merge', at: at(1), catchable: true },
      { ticket: 'app/02', place: 'heldout', at: at(4), catchable: true },
      { ticket: 'app/03', place: 'after-merge', at: at(6), catchable: false },
    ])
  })
})

describe('reworked code, the parts with no repository (#ms-outcome-rework)', () => {
  test('green merges with their commit; a red merge and a merge with no commit are out', () => {
    expect(
      greenMerges([
        b(1, 'ticket.merge', { id: 'app/01', green: true, commit: 'c1' }),
        b(2, 'ticket.merge', { id: 'app/02', green: false }),
        b(3, 'ticket.merge', { id: 'app/03', green: true }),
        b(4, 'ticket.moved', { id: 'app/01', to: 'done' }),
      ]),
    ).toEqual([{ ticket: 'app/01', commit: 'c1', at: at(1) }])
  })

  test('the commit pattern names the ticket\'s passes and its merge, with the id taken literally', () => {
    const re = new RegExp(ticketCommitPattern('app/0.1'), 'm')
    expect(re.test('werk build app/0.1: pass 2')).toBe(true)
    expect(re.test('werk: merge app/0.1')).toBe(true)
    expect(re.test('werk build app/0x1: pass 2')).toBe(false)
    expect(re.test('werk build app/0.10: pass 1')).toBe(false)
  })

  test('counts the blamed lines that came from the given commits', () => {
    const a = 'a'.repeat(40)
    const c = 'c'.repeat(40)
    const porcelain = [`${a} 1 1 2`, 'author x', '\tline one', `${a} 2 2`, '\tline two', `${c} 1 3 1`, '\tline three'].join('\n')
    expect(blamedLines(porcelain, new Set([a]))).toBe(2)
    expect(blamedLines(porcelain, new Set(['b'.repeat(40)]))).toBe(0)
  })
})

describe('reworkedCards (#ms-outcome-rework)', () => {
  test('a cited card reopened after the ticket started to build; a postponing reopen and an earlier one do not count', () => {
    const board = [
      b(1, 'ticket.cites', { id: 'app/01', cards: { 'app-login': {}, mail: {} } }),
      b(2, 'ticket.moved', { id: 'app/01', to: 'building' }),
      b(3, 'ticket.moved', { id: 'app/01', to: 'building' }),
      b(1, 'ticket.cites', { id: 'app/02', cards: { mail: {} } }),
      b(1, 'ticket.reordered', { ids: ['app/01'] }),
    ]
    const decisions = [
      d(1, 'reopened', { id: 'mail' }),
      d(4, 'reopened', { id: 'app-login', reason: 'invalidated' }),
      d(5, 'reopened', { id: 'mail', reason: 'postponed' }),
      d(6, 'status.set', { id: 'mail', status: 'decided' }),
    ]
    expect(reworkedCards(board, decisions)).toEqual([{ ticket: 'app/01', card: 'app-login', at: at(4) }])
  })
})

describe('reworkReport (#werk-cli-rework)', () => {
  test('one row per ticket with rework, with totals, open windows and gone merges', () => {
    const code = (ticket: string, lines: number, changed: number, extra: object = {}) => ({ ticket, commit: 'c', at: at(1), lines, changed, open: false, ...extra })
    const r = reworkReport(
      [
        { ticket: 'app/02', card: 'login', at: at(3) },
        { ticket: 'app/02', card: 'login', at: at(5) },
        { ticket: 'app/02', card: 'mail', at: at(6) },
      ],
      [code('app/01', 10, 2), code('app/02', 4, 0, { open: true }), code('app/03', 6, 0), code('app/04', 0, 0, { gone: true })],
    )
    expect(r.rows).toEqual([
      { ticket: 'app/01', cards: [], lines: 10, changed: 2 },
      { ticket: 'app/02', cards: ['login', 'mail'], lines: 0, changed: 0 },
    ])
    expect(r.totals).toEqual({ tickets: 2, cards: 2, changed: 2 })
    expect(r.open).toEqual(['app/02'])
    expect(r.gone).toEqual(['app/04'])
  })
})
