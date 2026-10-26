import { describe, expect, test } from 'bun:test'
import type { BoardEvent } from './board.ts'
import { columnReport, columnTimes } from './col-time.ts'

let seq = 0
const ev = (time: string, type: string, payload: object): BoardEvent =>
  ({ seq: ++seq, at: `2026-10-24T${time}:00.000Z`, actor: 'agent', type, payload }) as BoardEvent
const planned = (time: string, id: string, blockedBy: string[] = []) => ev(time, 'ticket.planned', { id, run: 'app', file: `${id}.md`, title: id, blockedBy })
const moved = (time: string, id: string, to: string) => ev(time, 'ticket.moved', { id, to })
const MIN = 60_000

describe('columnTimes (#ms-col-time)', () => {
  test('adds the visits per column, from the plan to done, with the count of visits', () => {
    const times = columnTimes([
      planned('10:00', 'app/01'),
      moved('10:30', 'app/01', 'building'),
      moved('10:42', 'app/01', 'blocked'),
      moved('14:00', 'app/01', 'ready'),
      moved('14:05', 'app/01', 'building'),
      moved('14:15', 'app/01', 'merging'),
      moved('14:17', 'app/01', 'done'),
    ])
    expect(times.map(({ column, ms, visits, openSince }) => [column, ms / MIN, visits, openSince])).toEqual([
      ['ready', 35, 2, undefined],
      ['building', 22, 2, undefined],
      ['blocked', 198, 1, undefined],
      ['merging', 2, 1, undefined],
    ])
  })

  test('a visit still running carries its start, and the report counts it up to now', () => {
    const times = columnTimes([planned('10:00', 'app/01'), moved('10:30', 'app/01', 'building'), moved('10:42', 'app/01', 'blocked')])
    const blocked = times.find((t) => t.column === 'blocked')!
    expect(blocked).toMatchObject({ ms: 0, visits: 1, openSince: '2026-10-24T10:42:00.000Z' })
    const report = columnReport(times, '2026-10-24T11:42:00.000Z')
    expect(report.find((r) => r.column === 'blocked')).toEqual({ column: 'blocked', ms: { n: 1, median: 60 * MIN, p90: 60 * MIN, max: 60 * MIN }, open: ['app/01'] })
    expect(report.find((r) => r.column === 'merging')!.ms.n).toBe(0)
  })

  test('a ticket planned with blockers starts in blocked, and a revision that drops them moves it to ready', () => {
    const times = columnTimes([planned('10:00', 'app/02', ['app/01']), ev('10:20', 'ticket.revised', { id: 'app/02', title: 'x', blockedBy: [] })])
    expect(times.map(({ column, ms, openSince }) => [column, ms / MIN, openSince])).toEqual([
      ['blocked', 20, undefined],
      ['ready', 0, '2026-10-24T10:20:00.000Z'],
    ])
  })

  test('an archive stops the clock, and a restore starts it again in the same column', () => {
    const times = columnTimes([
      planned('10:00', 'app/01'),
      ev('10:10', 'ticket.archived', { id: 'app/01' }),
      ev('12:00', 'ticket.restored', { id: 'app/01' }),
      moved('12:05', 'app/01', 'building'),
    ])
    expect(times.find((t) => t.column === 'ready')).toMatchObject({ ms: 15 * MIN, visits: 2 })
  })

  test('a done ticket is not timed, and events that name no ticket change nothing', () => {
    const times = columnTimes([
      planned('10:00', 'app/01'),
      moved('10:01', 'app/01', 'done'),
      ev('10:02', 'ticket.reordered', { ids: ['app/01'] }),
      moved('10:03', 'app/99', 'building'),
    ])
    expect(times).toEqual([{ ticket: 'app/01', column: 'ready', ms: MIN, visits: 1 }])
  })
})
