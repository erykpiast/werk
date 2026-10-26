import { expect, test } from 'bun:test'
import { linked } from '../../src/test/map-events.ts'
import { card, mapGraph, ok, seeded, SLOW } from './util.ts'

test('65.1 a rejected reopen marks only the next hop as stale', async () => {
  const p = seeded(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'))
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = ok(p, ['stale'])
  expect(out).toMatch(/^stale\s+#B\b/m)
  const entry = out.slice(out.indexOf('#B'))
  expect(entry).toContain('rejected #A')
  expect(entry).toContain('depends_on')
  expect(out).not.toContain('#C')
  const g = await mapGraph(p)
  expect(g.marks.C).toBeUndefined()
}, SLOW)

test('65.2 a postponed reopen pauses every downstream card and keeps their status', async () => {
  const p = seeded(
    ...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), ...card('D', 'decided'),
    linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'), linked('D', 'C', 'depends_on'),
  )
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const g = await mapGraph(p)
  for (const id of ['B', 'C', 'D']) expect(g.marks[id]?.mark).toBe('paused')
  expect(g.nodes.find((n) => n.id === 'D')?.status).toBe('decided')
  expect(ok(p, ['show', 'D'])).toContain('status: decided')
  const out = ok(p, ['stale'])
  expect(out).toMatch(/^paused\s+#D\b/m)
  const entry = out.slice(out.indexOf('#D'))
  expect(entry.split('\n')[1]).toContain('postponed #A')
  expect(Object.values(g.marks).some((m) => m.mark === 'stale')).toBe(false)
  expect(out).not.toMatch(/^stale\s/m)
}, SLOW)

test('65.3 stale wins when a postponement and a rejection reach the same card', async () => {
  const p = seeded(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), linked('C', 'A', 'depends_on'), linked('C', 'B', 'refines'))
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'B', '--reason', 'rejected', '--why', 'wrong'])
  const g = await mapGraph(p)
  expect(g.marks.C?.mark).toBe('stale')
  const out = ok(p, ['stale'])
  expect(out).toMatch(/^stale\s+#C\b/m)
  const entry = out.slice(out.indexOf('#C'))
  expect(entry).toContain('rejected #B')
}, SLOW)

test('65.4 rederive clears the mark on one card and leaves the others', async () => {
  const p = seeded(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), linked('B', 'A', 'depends_on'), linked('C', 'A', 'depends_on'))
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'wrong'])
  let out = ok(p, ['stale'])
  expect(out).toMatch(/^stale\s+#B\b/m)
  expect(out).toMatch(/^stale\s+#C\b/m)
  ok(p, ['rederive', 'B', 'confirm', '--why', 'B holds without A'])
  out = ok(p, ['stale'])
  expect(out).not.toContain('#B')
  expect(out).toMatch(/^stale\s+#C\b/m)
  expect(out.slice(out.indexOf('#C'))).toContain('rejected #A')
  const g = await mapGraph(p)
  expect(g.marks.B).toBeUndefined()
}, SLOW)

test('65.5 deciding a postponed card again clears the paused marks downstream', async () => {
  const p = seeded(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'open'), linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'))
  const before = ok(p, ['show', 'C']).match(/^status: .*$/m)![0]
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  let g = await mapGraph(p)
  expect(g.marks.B?.mark).toBe('paused')
  expect(g.marks.C?.mark).toBe('paused')
  ok(p, ['status', 'A', 'decided'])
  g = await mapGraph(p)
  expect(g.marks.B).toBeUndefined()
  expect(g.marks.C).toBeUndefined()
  const out = ok(p, ['stale'])
  expect(out).not.toContain('#B')
  expect(out).not.toContain('#C')
  expect(ok(p, ['show', 'C']).match(/^status: .*$/m)![0]).toBe(before)
}, SLOW)
