import { expect, test } from 'bun:test'
import { linked } from '../../src/test/map-events.ts'
import { card, ok, projectWith, servedGraph } from './helpers.ts'

/** The lines of the stale list that belong to one card: its head line and its indented trace lines. */
const entry = (out: string, id: string): string => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => new RegExp(`#${id}\\b`).test(l) && !l.startsWith(' '))
  if (i < 0) return ''
  const rest = []
  for (let j = i + 1; j < lines.length && lines[j]!.startsWith(' '); j++) rest.push(lines[j])
  return [lines[i], ...rest].join('\n')
}

test('65.1 A rejected reopen marks only the next hop as stale', async () => {
  const p = projectWith(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'))
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = ok(p, ['stale'])
  const b = entry(out, 'B')
  expect(b).toMatch(/^stale/)
  expect(b).toContain('#A')
  expect(b).toContain('depends_on')
  expect(b).toContain('rejected')
  expect(entry(out, 'C')).toBe('')
  const g = await servedGraph(p)
  expect(g.marks['C']).toBeUndefined()
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', async () => {
  const p = projectWith(
    ...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), ...card('D', 'decided'),
    linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'), linked('D', 'C', 'depends_on'),
  )
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const g = await servedGraph(p)
  for (const id of ['B', 'C', 'D']) expect(g.marks[id]?.mark).toBe('paused')
  expect(ok(p, ['show', 'D'])).toContain('status: decided')
  const d = entry(ok(p, ['stale']), 'D')
  expect(d).toMatch(/^paused/)
  expect(d).toContain('#A')
  expect(d).toContain('postponed')
  expect(Object.values(g.marks).filter((m) => m.mark === 'stale')).toHaveLength(0)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', async () => {
  const p = projectWith(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), linked('C', 'A', 'depends_on'), linked('C', 'B', 'refines'))
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'B', '--reason', 'rejected', '--why', 'wrong'])
  const g = await servedGraph(p)
  expect(g.marks['C']?.mark).toBe('stale')
  const c = entry(ok(p, ['stale']), 'C')
  expect(c).toMatch(/^stale/)
  expect(c).toContain('#B')
  expect(c).toContain('rejected')
})

test('65.4 Rederive clears the mark on one card and leaves the others', async () => {
  const p = projectWith(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'decided'), linked('B', 'A', 'depends_on'), linked('C', 'A', 'depends_on'))
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'wrong'])
  const before = ok(p, ['stale'])
  expect(entry(before, 'B')).toMatch(/^stale/)
  expect(entry(before, 'C')).toMatch(/^stale/)
  ok(p, ['rederive', 'B', 'confirm', '--why', 'B holds'])
  const out = ok(p, ['stale'])
  expect(entry(out, 'B')).toBe('')
  const c = entry(out, 'C')
  expect(c).toMatch(/^stale/)
  expect(c).toContain('#A')
  expect(c).toContain('rejected')
  expect((await servedGraph(p)).marks['B']).toBeUndefined()
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', async () => {
  const p = projectWith(...card('A', 'decided'), ...card('B', 'decided'), ...card('C', 'open'), linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'))
  const statusBefore = ok(p, ['show', 'C']).match(/^status: .*$/m)![0]
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  const g1 = await servedGraph(p)
  expect(g1.marks['B']?.mark).toBe('paused')
  expect(g1.marks['C']?.mark).toBe('paused')
  ok(p, ['status', 'A', 'decided'])
  const g2 = await servedGraph(p)
  expect(g2.marks['B']).toBeUndefined()
  expect(g2.marks['C']).toBeUndefined()
  const out = ok(p, ['stale'])
  expect(entry(out, 'B')).toBe('')
  expect(entry(out, 'C')).toBe('')
  expect(ok(p, ['show', 'C'])).toContain(statusBefore)
})
