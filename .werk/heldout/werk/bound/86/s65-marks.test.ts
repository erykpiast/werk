import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { newCtx, type Ctx } from './cli-helpers.ts'

let c: Ctx
afterEach(() => c?.p.cleanup())

/** The stale list as blocks: the head line of each marked card and its trace lines. */
const staleBlocks = () => {
  const out = c.w('stale').stdout
  const blocks = new Map<string, { mark: string; lines: string[] }>()
  let current: string | undefined
  for (const line of out.split('\n')) {
    const head = /^(stale|paused)\s+#(\S+)/.exec(line)
    if (head) {
      current = head[2]!
      blocks.set(current, { mark: head[1]!, lines: [line] })
    } else if (current && line.startsWith('  ')) blocks.get(current)!.lines.push(line)
    else current = undefined
  }
  return blocks
}
const statusOf = (id: string) => c.show(id).stdout.split('\n').find((l) => l.startsWith('status:'))

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  c = newCtx()
  c.decided('a', 'Card A')
  c.decided('b', 'Card B', { dependsOn: ['a'] })
  c.decided('c', 'Card C', { dependsOn: ['b'] })
  c.ok('reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong')

  const blocks = staleBlocks()
  expect(blocks.get('b')?.mark).toBe('stale')
  const trace = blocks.get('b')!.lines.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('depends_on')
  expect(trace).toContain('rejected')
  expect(blocks.has('c')).toBe(false)
  expect(c.graph().marks.c).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  c = newCtx()
  c.decided('a', 'Card A')
  c.decided('b', 'Card B', { dependsOn: ['a'] })
  c.decided('c', 'Card C', { dependsOn: ['b'] })
  c.decided('d', 'Card D', { dependsOn: ['c'] })
  c.ok('reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter')

  const marks = c.graph().marks
  for (const id of ['b', 'c', 'd']) expect(marks[id]?.mark).toBe('paused')
  expect(statusOf('d')).toBe('status: decided')
  const blocks = staleBlocks()
  expect(blocks.get('d')?.mark).toBe('paused')
  const trace = blocks.get('d')!.lines.join('\n')
  expect(trace).toContain('#a')
  expect(trace).toContain('postponed')
  expect(Object.values(marks).some((m) => m.mark === 'stale')).toBe(false)
  expect([...blocks.values()].some((b) => b.mark === 'stale')).toBe(false)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  c = newCtx()
  c.decided('a', 'Card A')
  c.decided('b', 'Card B')
  c.decided('c', 'Card C', { parent: 'b', dependsOn: ['a'] })
  c.ok('reopen', 'a', '--reason', 'postponed', '--why', 'later')
  c.ok('reopen', 'b', '--reason', 'rejected', '--why', 'wrong')

  expect(c.graph().marks.c?.mark).toBe('stale')
  const block = staleBlocks().get('c')
  expect(block?.mark).toBe('stale')
  expect(block!.lines.some((l) => l.includes('#b') && l.includes('rejected'))).toBe(true)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  c = newCtx()
  c.decided('a', 'Card A')
  c.decided('b', 'Card B', { dependsOn: ['a'] })
  c.decided('c', 'Card C', { dependsOn: ['a'] })
  c.ok('reopen', 'a', '--reason', 'rejected', '--why', 'wrong')
  let blocks = staleBlocks()
  expect(blocks.get('b')?.mark).toBe('stale')
  expect(blocks.get('c')?.mark).toBe('stale')

  expect(c.w('rederive', 'b', 'confirm', '--why', 'still holds').code).toBe(0)
  blocks = staleBlocks()
  expect(blocks.has('b')).toBe(false)
  expect(blocks.get('c')?.mark).toBe('stale')
  expect(blocks.get('c')!.lines.some((l) => l.includes('#a') && l.includes('rejected'))).toBe(true)
  expect(c.graph().marks.b).toBeUndefined()
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  c = newCtx()
  c.decided('a', 'Card A')
  c.decided('b', 'Card B', { dependsOn: ['a'] })
  c.decided('cc', 'Card C', { dependsOn: ['b'] })
  const before = statusOf('cc')
  c.ok('reopen', 'a', '--reason', 'postponed', '--why', 'later')
  expect(c.graph().marks.b?.mark).toBe('paused')
  expect(c.graph().marks.cc?.mark).toBe('paused')

  expect(c.w('status', 'a', 'decided').code).toBe(0)
  const marks = c.graph().marks
  expect(marks.b).toBeUndefined()
  expect(marks.cc).toBeUndefined()
  const blocks = staleBlocks()
  expect(blocks.has('b')).toBe(false)
  expect(blocks.has('cc')).toBe(false)
  expect(statusOf('cc')).toBe(before)
})
