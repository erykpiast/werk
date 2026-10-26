import { afterEach, expect, test } from 'bun:test'
import { ctx, decidedCard, fresh, markOf, ok, show, werk } from './helpers.ts'

afterEach(() => ctx.p?.cleanup())

const stale = () => ok(['stale'])
/** The block of the stale list for one card: its heading line and its trace lines. */
const entry = (out: string, id: string) => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^\\S+\\s+#${id}\\s`).test(l))
  if (i === -1) return undefined
  const block = [lines[i]!]
  for (const l of lines.slice(i + 1)) {
    if (!l.startsWith('  ')) break
    block.push(l)
  }
  return block.join('\n')
}

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  fresh()
  decidedCard('a', 'Card A')
  decidedCard('b', 'Card B', { deps: ['a'] })
  decidedCard('c', 'Card C', { deps: ['b'] })
  expect(werk(['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong']).code).toBe(0)
  const out = stale()
  const b = entry(out, 'b')
  expect(b).toBeDefined()
  expect(b!).toMatch(/^stale/)
  expect(b!).toContain('#a')
  expect(b!).toContain('depends_on')
  expect(b!).toContain('rejected')
  expect(entry(out, 'c')).toBeUndefined()
  expect(markOf('c')).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  fresh()
  decidedCard('a', 'Card A')
  decidedCard('b', 'Card B', { deps: ['a'] })
  decidedCard('c', 'Card C', { deps: ['b'] })
  decidedCard('d', 'Card D', { deps: ['c'] })
  expect(werk(['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter']).code).toBe(0)
  for (const id of ['b', 'c', 'd']) expect(markOf(id)).toBe('paused')
  expect(show('d')).toContain('status: decided')
  const out = stale()
  const d = entry(out, 'd')
  expect(d).toBeDefined()
  expect(d!).toMatch(/^paused/)
  expect(d!).toContain('#a')
  expect(d!).toContain('postponed')
  for (const id of ['a', 'b', 'c', 'd']) expect(markOf(id)).not.toBe('stale')
  expect(out).not.toMatch(/^stale/m)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  fresh()
  decidedCard('a', 'Card A')
  decidedCard('b', 'Card B')
  decidedCard('c', 'Card C', { deps: ['a'], parent: 'b' })
  expect(werk(['reopen', 'a', '--reason', 'postponed', '--why', 'later']).code).toBe(0)
  expect(werk(['reopen', 'b', '--reason', 'rejected', '--why', 'wrong']).code).toBe(0)
  expect(markOf('c')).toBe('stale')
  const c = entry(stale(), 'c')
  expect(c).toBeDefined()
  expect(c!).toMatch(/^stale/)
  expect(c!).toMatch(/rejected #b/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  fresh()
  decidedCard('a', 'Card A')
  decidedCard('b', 'Card B', { deps: ['a'] })
  decidedCard('c', 'Card C', { deps: ['a'] })
  ok(['reopen', 'a', '--reason', 'rejected', '--why', 'wrong store'])
  const before = stale()
  expect(entry(before, 'b')!).toMatch(/^stale/)
  expect(entry(before, 'c')!).toMatch(/^stale/)
  expect(werk(['rederive', 'b', 'confirm', '--why', 'b holds']).code).toBe(0)
  const after = stale()
  expect(entry(after, 'b')).toBeUndefined()
  const c = entry(after, 'c')
  expect(c).toBeDefined()
  expect(c!).toMatch(/^stale/)
  expect(c!).toMatch(/rejected #a/)
  expect(markOf('b')).toBeUndefined()
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  fresh()
  decidedCard('a', 'Card A')
  decidedCard('b', 'Card B', { deps: ['a'] })
  decidedCard('c', 'Card C', { deps: ['b'] })
  ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(markOf('b')).toBe('paused')
  expect(markOf('c')).toBe('paused')
  expect(werk(['status', 'a', 'decided']).code).toBe(0)
  expect(markOf('b')).toBeUndefined()
  expect(markOf('c')).toBeUndefined()
  const out = stale()
  expect(entry(out, 'b')).toBeUndefined()
  expect(entry(out, 'c')).toBeUndefined()
  expect(show('c')).toContain('status: decided')
})
