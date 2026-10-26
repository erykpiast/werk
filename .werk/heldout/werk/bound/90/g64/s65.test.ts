/** Held-out steps 65.1–65.5: stale and paused marks after a reopen. */
import { afterEach, expect, test } from 'bun:test'
import type { NewEvent } from '../../src/map/events.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, killed, linked, noBasis, proposed, statusSet, whoSet } from '../../src/test/map-events.ts'
import { mapMark, mapStatus, ok, writeLog } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** A real card with its decide facts, then decided (or left open). */
const card = (id: string, decided = true): NewEvent[] => [
  proposed(id, { title: `Card ${id}` }),
  accepted(id),
  whoSet(id, 'me'),
  noBasis(id, 'a test card'),
  killed(id),
  ...(decided ? [statusSet(id, 'decided')] : []),
]

/** The stale list as entries: the head line of each card and the trace lines under it. */
const staleEntries = () => {
  const out = ok(p, ['stale']).stdout
  const entries = new Map<string, { mark: string; text: string }>()
  let cur: string | undefined
  for (const line of out.split('\n')) {
    const m = line.match(/^(stale|paused)\s+#(\S+)/)
    if (m) {
      cur = m[2]!
      entries.set(cur, { mark: m[1]!, text: line })
    } else if (cur && line.startsWith('  ')) entries.get(cur)!.text += '\n' + line
    else cur = undefined
  }
  return entries
}

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = makeProject()
  writeLog(p, ...card('A'), ...card('B'), ...card('C'), linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'))
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const list = staleEntries()
  expect(list.get('B')?.mark).toBe('stale')
  expect(list.get('B')!.text).toContain('#A')
  expect(list.get('B')!.text).toContain('depends_on')
  expect(list.get('B')!.text).toContain('rejected')
  expect(list.has('C')).toBe(false)
  expect(mapMark(p, 'C')).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = makeProject()
  writeLog(
    p,
    ...card('A'),
    ...card('B'),
    ...card('C'),
    ...card('D'),
    linked('B', 'A', 'depends_on'),
    linked('C', 'B', 'depends_on'),
    linked('D', 'C', 'depends_on'),
  )
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['B', 'C', 'D']) expect(mapMark(p, id)).toBe('paused')
  expect(mapStatus(p, 'D')).toBe('decided')
  const list = staleEntries()
  expect(list.get('D')?.mark).toBe('paused')
  expect(list.get('D')!.text).toContain('#A')
  expect(list.get('D')!.text).toContain('postponed')
  for (const id of ['A', 'B', 'C', 'D']) expect(mapMark(p, id)).not.toBe('stale')
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = makeProject()
  writeLog(p, ...card('A'), ...card('B'), ...card('C'), linked('C', 'A', 'depends_on'))
  // C refines B: give C the parent B through a refines link.
  ok(p, ['link', 'C', 'B', '--type', 'refines'])
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'B', '--reason', 'rejected', '--why', 'wrong'])
  expect(mapMark(p, 'C')).toBe('stale')
  const c = staleEntries().get('C')
  expect(c?.mark).toBe('stale')
  expect(c!.text).toMatch(/rejected #B/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = makeProject()
  writeLog(p, ...card('A'), ...card('B'), ...card('C'), linked('B', 'A', 'depends_on'), linked('C', 'A', 'depends_on'))
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'wrong'])
  const before = staleEntries()
  expect(before.get('B')?.mark).toBe('stale')
  expect(before.get('C')?.mark).toBe('stale')

  ok(p, ['rederive', 'B', 'confirm', '--why', 'B holds without A'])
  const after = staleEntries()
  expect(after.has('B')).toBe(false)
  expect(after.get('C')?.mark).toBe('stale')
  expect(after.get('C')!.text).toMatch(/rejected #A/)
  expect(mapMark(p, 'B')).toBeUndefined()
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = makeProject()
  writeLog(p, ...card('A'), ...card('B'), ...card('C'), linked('B', 'A', 'depends_on'), linked('C', 'B', 'depends_on'))
  const statusBefore = mapStatus(p, 'C')
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  expect(mapMark(p, 'B')).toBe('paused')
  expect(mapMark(p, 'C')).toBe('paused')

  ok(p, ['status', 'A', 'decided'])
  expect(mapMark(p, 'B')).toBeUndefined()
  expect(mapMark(p, 'C')).toBeUndefined()
  const list = staleEntries()
  expect(list.has('B')).toBe(false)
  expect(list.has('C')).toBe(false)
  expect(mapStatus(p, 'C')).toBe(statusBefore)
})
