/** Feature 65: stale and paused marks from reopens. */
import { afterEach, expect, test } from 'bun:test'
import { accepted, graph, killed, linked, makeProject, noBasis, ok, proposed, seed, statusSet, type Project } from './helpers.ts'
import type { NewEvent } from '../../src/map/events.ts'

let p: Project
afterEach(() => p?.cleanup())

/** A real card with every contract fact, decided when asked. `on` names its depends_on targets, `parent` its parent. */
function card(id: string, o: { on?: string[]; parent?: string; decided?: boolean; status?: 'open' | 'decided' } = {}): NewEvent[] {
  const evs: NewEvent[] = [proposed(id, { title: `Card ${id.toUpperCase()}`, who: 'me', ...(o.parent && { parent: o.parent }) }), accepted(id)]
  if (!o.on?.length && !o.parent) evs.push(noBasis(id, 'a root card'))
  for (const t of o.on ?? []) evs.push(linked(id, t, 'depends_on', `takes ${t}`))
  evs.push(killed(id))
  evs.push(statusSet(id, o.decided === false ? 'open' : 'decided'))
  return evs
}

const staleList = () => p.werk(['stale']).stdout
/** The block of the stale list for one card: its mark line and the trace lines under it. */
function entry(id: string): string | undefined {
  const lines = staleList().split('\n')
  const at = lines.findIndex((l) => new RegExp(`^(stale|paused)\\s+#${id}\\s`).test(l))
  if (at === -1) return undefined
  const block = [lines[at]!]
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith('  ')) break
    block.push(l)
  }
  return block.join('\n')
}
const marks = () => graph(p).marks

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = makeProject()
  seed(p, ...card('a'), ...card('b', { on: ['a'] }), ...card('c', { on: ['b'] }))
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const b = entry('b')
  expect(b).toBeDefined()
  expect(b!).toMatch(/^stale\s+#b/)
  expect(b!).toContain('#a')
  expect(b!).toContain('depends_on')
  expect(b!).toContain('rejected')
  expect(entry('c')).toBeUndefined()
  expect(marks()['c']).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = makeProject()
  seed(p, ...card('a'), ...card('b', { on: ['a'] }), ...card('c', { on: ['b'] }), ...card('d', { on: ['c'] }))
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['b', 'c', 'd']) expect(marks()[id]?.mark).toBe('paused')
  expect(p.werk(['show', 'd']).stdout).toContain('status: decided')
  const d = entry('d')
  expect(d).toBeDefined()
  expect(d!).toMatch(/^paused\s+#d/)
  expect(d!).toContain('#a')
  expect(d!).toContain('postponed')
  expect(Object.values(marks()).some((m) => m.mark === 'stale')).toBe(false)
  expect(staleList()).not.toMatch(/^stale\s/m)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = makeProject()
  seed(p, ...card('a'), ...card('b'), ...card('c', { on: ['a'], parent: 'b' }))
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  expect(marks()['c']?.mark).toBe('stale')
  const c = entry('c')!
  expect(c).toMatch(/^stale\s+#c/)
  expect(c).toMatch(/rejected #b/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = makeProject()
  seed(p, ...card('a'), ...card('b', { on: ['a'] }), ...card('c', { on: ['a'] }))
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  expect(entry('b')).toMatch(/^stale/)
  expect(entry('c')).toMatch(/^stale/)
  ok(p, ['rederive', 'b', 'confirm', '--why', 'still holds'])
  expect(entry('b')).toBeUndefined()
  const c = entry('c')!
  expect(c).toMatch(/^stale\s+#c/)
  expect(c).toMatch(/rejected #a/)
  expect(marks()['b']).toBeUndefined()
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = makeProject()
  seed(p, ...card('a'), ...card('b', { on: ['a'] }), ...card('c', { on: ['b'] }))
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(marks()['b']?.mark).toBe('paused')
  expect(marks()['c']?.mark).toBe('paused')
  const status = p.werk(['status', 'a', 'decided'])
  expect(status.code).toBe(0)
  expect(marks()['b']).toBeUndefined()
  expect(marks()['c']).toBeUndefined()
  expect(entry('b')).toBeUndefined()
  expect(entry('c')).toBeUndefined()
  expect(p.werk(['show', 'c']).stdout).toContain('status: decided')
})
