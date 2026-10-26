import { afterEach, expect, test } from 'bun:test'
import { ok, project, type P } from '../lib.ts'
import { accepted, killed, linked, noBasis, proposed } from '../../src/test/map-events.ts'
import type { NewEvent } from '../../src/map/events.ts'

let p: P
afterEach(() => p?.cleanup())

/** A real card with every fact. A card with no basis records why. */
const card = (id: string, status: 'open' | 'decided' = 'decided', basis = false): NewEvent[] => [
  proposed(id, { title: `Card ${id.toUpperCase()}`, status, who: 'me' }),
  ...(basis ? [] : [noBasis(id, 'a root card')]),
  killed(id),
  accepted(id),
]

/** The stale list as blocks: one head line per card, with its trace lines under it. */
function staleList(): Map<string, { mark: string; traces: string[] }> {
  const out = ok(p.w('stale')).stdout.split('\n')
  const list = new Map<string, { mark: string; traces: string[] }>()
  let current: { mark: string; traces: string[] } | undefined
  for (const line of out) {
    const head = /^(stale|paused)\s+#(\S+)/.exec(line)
    if (head) {
      current = { mark: head[1]!, traces: [] }
      list.set(head[2]!, current)
    } else if (/^\s{2}\S/.test(line) && current) current.traces.push(line)
    else current = undefined
  }
  return list
}

const showOf = (id: string) => ok(p.w('show', id)).stdout

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = project()
  p.seed(...card('a'), ...card('b', 'decided', true), linked('b', 'a', 'depends_on'), ...card('c', 'decided', true), linked('c', 'b', 'depends_on'))
  ok(p.w('reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'))
  const list = staleList()
  expect(list.get('b')?.mark).toBe('stale')
  const trace = list.get('b')!.traces.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('depends_on')
  expect(trace).toContain('rejected')
  expect(list.has('c')).toBe(false)
  expect(showOf('c')).not.toMatch(/stale|paused/)
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = project()
  p.seed(
    ...card('a'),
    ...card('b', 'decided', true),
    linked('b', 'a', 'depends_on'),
    ...card('c', 'decided', true),
    linked('c', 'b', 'depends_on'),
    ...card('d', 'decided', true),
    linked('d', 'c', 'depends_on'),
  )
  ok(p.w('reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'))
  const list = staleList()
  for (const id of ['b', 'c', 'd']) expect(list.get(id)?.mark).toBe('paused')
  expect(showOf('d')).toContain('status: decided')
  const trace = list.get('d')!.traces.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('postponed')
  expect([...list.values()].some((m) => m.mark === 'stale')).toBe(false)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = project()
  p.seed(...card('a'), ...card('b'), ...card('c', 'decided', true), linked('c', 'a', 'depends_on'), linked('c', 'b', 'refines'))
  ok(p.w('reopen', 'a', '--reason', 'postponed', '--why', 'a waits'))
  ok(p.w('reopen', 'b', '--reason', 'rejected', '--why', 'b is wrong'))
  const list = staleList()
  expect(list.get('c')?.mark).toBe('stale')
  const trace = list.get('c')!.traces.join('\n')
  expect(trace).toMatch(/rejected #b/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = project()
  p.seed(...card('a'), ...card('b', 'decided', true), linked('b', 'a', 'depends_on'), ...card('c', 'decided', true), linked('c', 'a', 'depends_on'))
  ok(p.w('reopen', 'a', '--reason', 'rejected', '--why', 'a is wrong'))
  let list = staleList()
  expect(list.get('b')?.mark).toBe('stale')
  expect(list.get('c')?.mark).toBe('stale')
  ok(p.w('rederive', 'b', 'confirm', '--why', 'b still holds'))
  list = staleList()
  expect(list.has('b')).toBe(false)
  expect(list.get('c')?.mark).toBe('stale')
  const trace = list.get('c')!.traces.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('rejected')
  expect(showOf('b')).not.toMatch(/stale/)
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = project()
  p.seed(...card('a'), ...card('b', 'decided', true), linked('b', 'a', 'depends_on'), ...card('c', 'open', true), linked('c', 'b', 'depends_on'))
  const statusBefore = showOf('c').split('\n').find((l) => l.startsWith('status:'))
  ok(p.w('reopen', 'a', '--reason', 'postponed', '--why', 'a waits'))
  let list = staleList()
  expect(list.get('b')?.mark).toBe('paused')
  expect(list.get('c')?.mark).toBe('paused')
  ok(p.w('status', 'a', 'decided'))
  list = staleList()
  expect(list.has('b')).toBe(false)
  expect(list.has('c')).toBe(false)
  expect(showOf('c').split('\n').find((l) => l.startsWith('status:'))).toBe(statusBefore)
})
