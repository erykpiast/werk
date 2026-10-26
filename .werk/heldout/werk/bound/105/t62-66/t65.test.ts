/** Held-out steps of ticket 65: stale and paused marks after a reopen. */
import { expect, test } from 'bun:test'
import { project } from './helpers.ts'

/** The stale list as blocks: the mark line of each card with its trace lines. */
function entries(text: string): Map<string, { mark: string; traces: string[] }> {
  const out = new Map<string, { mark: string; traces: string[] }>()
  let current: { mark: string; traces: string[] } | undefined
  for (const line of text.split('\n')) {
    const head = line.match(/^(stale|paused)\s+#(\S+)/)
    if (head) {
      current = { mark: head[1]!, traces: [] }
      out.set(head[2]!, current)
    } else if (line.startsWith('  ') && current) current.traces.push(line)
    else current = undefined
  }
  return out
}

test('65.1 A rejected reopen marks only the next hop as stale', () => {
  const p = project()
  p.decided('a', 'Card A')
  p.decided('b', 'Card B', { dependsOn: ['a'] })
  p.decided('c', 'Card C', { dependsOn: ['b'] })
  p.ok('reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong')
  const list = entries(p.stale())
  expect(list.get('b')?.mark).toBe('stale')
  const t = list.get('b')!.traces.join('\n')
  expect(t).toContain('#a')
  expect(t).toContain('depends_on')
  expect(t).toContain('rejected')
  expect(list.has('c')).toBe(false)
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', () => {
  const p = project()
  p.decided('a', 'Card A')
  p.decided('b', 'Card B', { dependsOn: ['a'] })
  p.decided('c', 'Card C', { dependsOn: ['b'] })
  p.decided('d', 'Card D', { dependsOn: ['c'] })
  p.ok('reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter')
  const list = entries(p.stale())
  for (const id of ['b', 'c', 'd']) expect(list.get(id)?.mark).toBe('paused')
  expect(p.show('d')).toContain('status: decided')
  const t = list.get('d')!.traces.join('\n')
  expect(t).toContain('#a')
  expect(t).toContain('postponed')
  expect([...list.values()].some((e) => e.mark === 'stale')).toBe(false)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', () => {
  const p = project()
  p.decided('a', 'Card A')
  p.decided('b', 'Card B')
  p.decided('c', 'Card C', { parent: 'b', dependsOn: ['a'] })
  p.ok('reopen', 'a', '--reason', 'postponed', '--why', 'later')
  p.ok('reopen', 'b', '--reason', 'rejected', '--why', 'wrong')
  const list = entries(p.stale())
  expect(list.get('c')?.mark).toBe('stale')
  expect(list.get('c')!.traces.some((l) => l.includes('rejected #b'))).toBe(true)
})

test('65.4 Rederive clears the mark on one card and leaves the others', () => {
  const p = project()
  p.decided('a', 'Card A')
  p.decided('b', 'Card B', { dependsOn: ['a'] })
  p.decided('c', 'Card C', { dependsOn: ['a'] })
  p.ok('reopen', 'a', '--reason', 'rejected', '--why', 'wrong')
  let list = entries(p.stale())
  expect(list.get('b')?.mark).toBe('stale')
  expect(list.get('c')?.mark).toBe('stale')
  p.ok('rederive', 'b', 'confirm', '--why', 'B still holds')
  list = entries(p.stale())
  expect(list.has('b')).toBe(false)
  expect(list.get('c')?.mark).toBe('stale')
  expect(list.get('c')!.traces.some((l) => l.includes('rejected #a'))).toBe(true)
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', () => {
  const p = project()
  p.decided('a', 'Card A')
  p.decided('b', 'Card B', { dependsOn: ['a'] })
  p.decided('c', 'Card C', { dependsOn: ['b'] })
  const statusBefore = p.show('c').split('\n').find((l) => l.startsWith('status:'))
  p.ok('reopen', 'a', '--reason', 'postponed', '--why', 'later')
  let list = entries(p.stale())
  expect(list.get('b')?.mark).toBe('paused')
  expect(list.get('c')?.mark).toBe('paused')
  p.ok('status', 'a', 'decided')
  list = entries(p.stale())
  expect(list.has('b')).toBe(false)
  expect(list.has('c')).toBe(false)
  expect(p.show('c').split('\n').find((l) => l.startsWith('status:'))).toBe(statusBefore)
})
