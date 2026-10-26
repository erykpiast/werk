/** Held-out steps 65.x: stale and paused marks from a reopen. */
import { expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { decidedCard, markOf, ok, project, statusInMap } from './helpers.ts'

/** The stale list, as blocks: one head line per card with the lines under it. */
function staleList(p: Project): Map<string, { mark: string; lines: string[] }> {
  const out = ok(p, ['stale']).stdout
  const blocks = new Map<string, { mark: string; lines: string[] }>()
  let current: string | undefined
  for (const line of out.split('\n')) {
    const head = /^(stale|paused)\s+#(\S+)/.exec(line)
    if (head) {
      current = head[2]!
      blocks.set(current, { mark: head[1]!, lines: [] })
    } else if (current && line.startsWith('  ')) blocks.get(current)!.lines.push(line)
    else current = undefined
  }
  return blocks
}

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  const p = project()
  decidedCard(p, 'a')
  decidedCard(p, 'b', { dependsOn: ['a'] })
  decidedCard(p, 'c', { dependsOn: ['b'] })
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const list = staleList(p)
  expect(list.get('b')?.mark).toBe('stale')
  const entry = list.get('b')!.lines.join('\n')
  expect(entry).toContain('#a')
  expect(entry).toContain('depends_on')
  expect(entry).toContain('rejected')
  expect(list.has('c')).toBe(false)
  expect(markOf(p, 'c')).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  const p = project()
  decidedCard(p, 'a')
  decidedCard(p, 'b', { dependsOn: ['a'] })
  decidedCard(p, 'c', { dependsOn: ['b'] })
  decidedCard(p, 'd', { dependsOn: ['c'] })
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['b', 'c', 'd']) expect(markOf(p, id)).toBe('paused')
  expect(statusInMap(p, 'd')).toBe('decided')
  const list = staleList(p)
  expect(list.get('d')?.mark).toBe('paused')
  const entry = list.get('d')!.lines.join('\n')
  expect(entry).toContain('#a')
  expect(entry).toContain('postponed')
  for (const id of ['a', 'b', 'c', 'd']) expect(markOf(p, id)).not.toBe('stale')
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  const p = project()
  decidedCard(p, 'a')
  decidedCard(p, 'b')
  decidedCard(p, 'c', { dependsOn: ['a'], parent: 'b' })
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  expect(markOf(p, 'c')).toBe('stale')
  const list = staleList(p)
  expect(list.get('c')?.mark).toBe('stale')
  const entry = list.get('c')!.lines.join('\n')
  expect(entry).toMatch(/rejected #b/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  const p = project()
  decidedCard(p, 'a')
  decidedCard(p, 'b', { dependsOn: ['a'] })
  decidedCard(p, 'c', { dependsOn: ['a'] })
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  const before = staleList(p)
  expect(before.get('b')?.mark).toBe('stale')
  expect(before.get('c')?.mark).toBe('stale')
  ok(p, ['rederive', 'b', 'confirm', '--why', 'still holds'])
  const after = staleList(p)
  expect(after.has('b')).toBe(false)
  expect(after.get('c')?.mark).toBe('stale')
  const entry = after.get('c')!.lines.join('\n')
  expect(entry).toContain('#a')
  expect(entry).toContain('rejected')
  expect(markOf(p, 'b')).toBeUndefined()
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  const p = project()
  decidedCard(p, 'a')
  decidedCard(p, 'b', { dependsOn: ['a'] })
  decidedCard(p, 'c', { dependsOn: ['b'] })
  const cBefore = statusInMap(p, 'c')
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(markOf(p, 'b')).toBe('paused')
  expect(markOf(p, 'c')).toBe('paused')
  ok(p, ['status', 'a', 'decided'])
  expect(markOf(p, 'b')).toBeUndefined()
  expect(markOf(p, 'c')).toBeUndefined()
  const list = staleList(p)
  expect(list.has('b')).toBe(false)
  expect(list.has('c')).toBe(false)
  expect(statusInMap(p, 'c')).toBe(cBefore)
})
