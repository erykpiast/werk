import { test, expect, afterEach } from 'bun:test'
import { project, staleEntry, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

test('65.1 A rejected reopen marks only the next hop as stale', () => {
  p = project()
  p.decided('A'); p.decided('B', ['A']); p.decided('C', ['B'])
  p.ok(['reopen', 'A', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = p.ok(['stale'])
  const b = staleEntry(out, 'B')
  expect(b).toBeDefined()
  expect(b!).toMatch(/^stale\s+#B/)
  expect(b!).toContain('#A'); expect(b!).toContain('depends_on'); expect(b!).toContain('rejected')
  expect(staleEntry(out, 'C')).toBeUndefined()
  expect(out).not.toMatch(/#C\b/)
  expect(p.graph().marks['C']).toBeUndefined()
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', () => {
  p = project()
  p.decided('A'); p.decided('B', ['A']); p.decided('C', ['B']); p.decided('D', ['C'])
  p.ok(['reopen', 'A', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const g = p.graph()
  for (const id of ['B', 'C', 'D']) expect(g.marks[id]?.mark).toBe('paused')
  expect(g.nodes.find((n) => n.id === 'D')!.status).toBe('decided')
  const d = staleEntry(p.ok(['stale']), 'D')
  expect(d).toBeDefined()
  expect(d!).toMatch(/^paused\s+#D/)
  expect(d!).toContain('#A'); expect(d!).toContain('postponed')
  expect(Object.values(g.marks).some((m) => m.mark === 'stale')).toBe(false)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', () => {
  p = project()
  p.decided('A'); p.decided('B')
  p.decided('C', ['A'], { parent: 'B' })
  p.ok(['reopen', 'A', '--reason', 'postponed', '--why', 'waits'])
  p.ok(['reopen', 'B', '--reason', 'rejected', '--why', 'wrong'])
  expect(p.graph().marks['C']?.mark).toBe('stale')
  const c = staleEntry(p.ok(['stale']), 'C')
  expect(c).toBeDefined()
  expect(c!).toMatch(/^stale\s+#C/)
  expect(c!).toMatch(/rejected #B/)
})

test('65.4 Rederive clears the mark on one card and leaves the others', () => {
  p = project()
  p.decided('A'); p.decided('B', ['A']); p.decided('C', ['A'])
  p.ok(['reopen', 'A', '--reason', 'rejected', '--why', 'wrong'])
  const before = p.ok(['stale'])
  expect(staleEntry(before, 'B')).toMatch(/^stale/); expect(staleEntry(before, 'C')).toMatch(/^stale/)
  p.ok(['rederive', 'B', 'confirm', '--why', 'still holds'])
  const out = p.ok(['stale'])
  expect(staleEntry(out, 'B')).toBeUndefined()
  const c = staleEntry(out, 'C')
  expect(c).toMatch(/^stale\s+#C/)
  expect(c!).toMatch(/rejected #A/)
  expect(p.graph().marks['B']).toBeUndefined()
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', () => {
  p = project()
  p.decided('A'); p.decided('B', ['A']); p.decided('C', ['B'])
  p.ok(['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  expect(p.graph().marks['B']?.mark).toBe('paused'); expect(p.graph().marks['C']?.mark).toBe('paused')
  const statusBefore = 'decided'
  p.ok(['status', 'A', 'decided'])
  const g = p.graph()
  expect(g.marks['B']).toBeUndefined(); expect(g.marks['C']).toBeUndefined()
  const out = p.ok(['stale'])
  expect(staleEntry(out, 'B')).toBeUndefined(); expect(staleEntry(out, 'C')).toBeUndefined()
  expect(g.nodes.find((n) => n.id === 'C')!.status).toBe(statusBefore)
})
