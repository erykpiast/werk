import { afterEach, expect, test } from 'bun:test'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { decided, markOnMap, nodeOnMap, ok } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The stale list as entries: the mark line of a card and its trace lines. */
function staleList(): Map<string, { mark: string; traces: string[] }> {
  const r = ok(p, ['stale'])
  const entries = new Map<string, { mark: string; traces: string[] }>()
  let cur: { mark: string; traces: string[] } | undefined
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(stale|paused)\s+#(\S+)/)
    if (m) {
      cur = { mark: m[1]!, traces: [] }
      entries.set(m[2]!, cur)
    } else if (line.startsWith('  ') && cur) cur.traces.push(line.trim())
    else cur = undefined
  }
  return entries
}

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = makeProject()
  decided(p, 'a')
  decided(p, 'b', 'a')
  decided(p, 'c', 'b')
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])

  const list = staleList()
  expect(list.get('b')?.mark).toBe('stale')
  const trace = list.get('b')!.traces.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('depends_on')
  expect(trace).toContain('rejected')
  expect(list.has('c')).toBe(false)
  expect(markOnMap(p, 'c')).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = makeProject()
  decided(p, 'a')
  decided(p, 'b', 'a')
  decided(p, 'c', 'b')
  decided(p, 'd', 'c')
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])

  for (const id of ['b', 'c', 'd']) expect(markOnMap(p, id)).toBe('paused')
  expect(nodeOnMap(p, 'd')?.status).toBe('decided')
  const list = staleList()
  expect(list.get('d')?.mark).toBe('paused')
  const trace = list.get('d')!.traces.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('postponed')
  for (const id of ['a', 'b', 'c', 'd']) expect(markOnMap(p, id)).not.toBe('stale')
  expect([...list.values()].some((e) => e.mark === 'stale')).toBe(false)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = makeProject()
  decided(p, 'a')
  decided(p, 'b')
  decided(p, 'c', 'a', ['--parent', 'b'])
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])

  expect(markOnMap(p, 'c')).toBe('stale')
  const list = staleList()
  expect(list.get('c')?.mark).toBe('stale')
  expect(list.get('c')!.traces.some((t) => t.includes('rejected') && t.includes('#b'))).toBe(true)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = makeProject()
  decided(p, 'a')
  decided(p, 'b', 'a')
  decided(p, 'c', 'a')
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  let list = staleList()
  expect(list.get('b')?.mark).toBe('stale')
  expect(list.get('c')?.mark).toBe('stale')

  ok(p, ['rederive', 'b', 'confirm', '--why', 'b still holds'])
  list = staleList()
  expect(list.has('b')).toBe(false)
  expect(list.get('c')?.mark).toBe('stale')
  const trace = list.get('c')!.traces.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('rejected')
  expect(markOnMap(p, 'b')).toBeUndefined()
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = makeProject()
  decided(p, 'a')
  decided(p, 'b', 'a')
  decided(p, 'c', 'b')
  const statusBefore = nodeOnMap(p, 'c')?.status
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(markOnMap(p, 'b')).toBe('paused')
  expect(markOnMap(p, 'c')).toBe('paused')

  ok(p, ['status', 'a', 'decided'])
  expect(markOnMap(p, 'b')).toBeUndefined()
  expect(markOnMap(p, 'c')).toBeUndefined()
  const list = staleList()
  expect(list.has('b')).toBe(false)
  expect(list.has('c')).toBe(false)
  expect(nodeOnMap(p, 'c')?.status).toBe(statusBefore)
})
