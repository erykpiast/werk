import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

/** The stale list as entries: the head line of each marked card with its trace lines. */
function staleEntries(): Map<string, { mark: string; traces: string[] }> {
  const out = p.ok(['stale']).stdout
  const entries = new Map<string, { mark: string; traces: string[] }>()
  let current: { mark: string; traces: string[] } | undefined
  for (const line of out.split('\n')) {
    const head = line.match(/^(stale|paused)\s+#(\S+)/)
    if (head) {
      current = { mark: head[1]!, traces: [] }
      entries.set(head[2]!, current)
    } else if (/^\s+\S/.test(line) && current) current.traces.push(line)
    else current = undefined
  }
  return entries
}
const mark = (id: string) => p.graph().marks[id]?.mark
const status = (id: string) => p.graph().nodes.find((n) => n.id === id)?.status

test('65.1', () => {
  p = project()
  p.decided('a')
  p.decided('b', { dependsOn: ['a'] })
  p.decided('c', { dependsOn: ['b'] })
  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const list = staleEntries()
  expect(list.get('b')?.mark).toBe('stale')
  const t = list.get('b')!.traces.join('\n')
  expect(t).toContain('#a')
  expect(t).toContain('depends_on')
  expect(t).toContain('rejected')
  expect(list.has('c')).toBe(false)
  expect(mark('c')).toBeUndefined()
})

test('65.2', () => {
  p = project()
  p.decided('a')
  p.decided('b', { dependsOn: ['a'] })
  p.decided('c', { dependsOn: ['b'] })
  p.decided('d', { dependsOn: ['c'] })
  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['b', 'c', 'd']) expect(mark(id)).toBe('paused')
  expect(status('d')).toBe('decided')
  const list = staleEntries()
  expect(list.get('d')?.mark).toBe('paused')
  const t = list.get('d')!.traces.join('\n')
  expect(t).toContain('#a')
  expect(t).toContain('postponed')
  expect(Object.values(p.graph().marks).some((m) => m.mark === 'stale')).toBe(false)
  expect([...list.values()].some((e) => e.mark === 'stale')).toBe(false)
})

test('65.3', () => {
  p = project()
  p.decided('a')
  p.decided('b')
  p.decided('c', { dependsOn: ['a'], parent: 'b' })
  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  p.ok(['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  expect(mark('c')).toBe('stale')
  const e = staleEntries().get('c')
  expect(e?.mark).toBe('stale')
  expect(e!.traces.some((l) => l.includes('rejected #b'))).toBe(true)
})

test('65.4', () => {
  p = project()
  p.decided('a')
  p.decided('b', { dependsOn: ['a'] })
  p.decided('c', { dependsOn: ['a'] })
  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  let list = staleEntries()
  expect(list.get('b')?.mark).toBe('stale')
  expect(list.get('c')?.mark).toBe('stale')
  p.ok(['rederive', 'b', 'confirm', '--why', 'still holds'])
  list = staleEntries()
  expect(list.has('b')).toBe(false)
  expect(list.get('c')?.mark).toBe('stale')
  expect(list.get('c')!.traces.some((l) => l.includes('rejected #a'))).toBe(true)
  expect(mark('b')).toBeUndefined()
})

test('65.5', () => {
  p = project()
  p.decided('a')
  p.decided('b', { dependsOn: ['a'] })
  p.decided('c', { dependsOn: ['b'] })
  const cBefore = status('c')
  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(mark('b')).toBe('paused')
  expect(mark('c')).toBe('paused')
  p.ok(['status', 'a', 'decided'])
  expect(mark('b')).toBeUndefined()
  expect(mark('c')).toBeUndefined()
  const list = staleEntries()
  expect(list.has('b')).toBe(false)
  expect(list.has('c')).toBe(false)
  expect(status('c')).toBe(cBefore)
})
