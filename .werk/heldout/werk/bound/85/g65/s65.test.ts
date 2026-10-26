import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { linked } from '../../src/test/map-events.ts'
import { mark, ok, projectWith, realCard } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The block of the stale list that one card heads: its head line and its trace lines. */
const entry = (out: string, id: string) => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^\\w+\\s+#${id}\\s`).test(l))
  if (i === -1) return undefined
  const block = [lines[i]!]
  for (let j = i + 1; j < lines.length && lines[j]!.startsWith('  '); j++) block.push(lines[j]!)
  return block.join('\n')
}

test('65.1 A rejected reopen marks only the next hop as stale', () => {
  p = projectWith(
    ...realCard('a', 'Card A', { status: 'decided' }),
    ...realCard('b', 'Card B', { status: 'decided' }),
    ...realCard('c', 'Card C', { status: 'decided' }),
    linked('b', 'a', 'depends_on'),
    linked('c', 'b', 'depends_on'),
  )
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = ok(p, ['stale'])
  const b = entry(out, 'b')
  expect(b).toBeDefined()
  expect(b!).toMatch(/^stale/)
  expect(b!).toContain('#a')
  expect(b!).toContain('depends_on')
  expect(b!).toContain('rejected')
  expect(entry(out, 'c')).toBeUndefined()
  expect(out).not.toContain('#c')
  expect(mark(p, 'c')).toBeUndefined()
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', () => {
  p = projectWith(
    ...['a', 'b', 'c', 'd'].flatMap((id) => realCard(id, `Card ${id.toUpperCase()}`, { status: 'decided' })),
    linked('b', 'a', 'depends_on'),
    linked('c', 'b', 'depends_on'),
    linked('d', 'c', 'depends_on'),
  )
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['b', 'c', 'd']) expect({ id, mark: mark(p, id) }).toEqual({ id, mark: 'paused' })
  expect(ok(p, ['show', 'd'])).toContain('status: decided')
  const out = ok(p, ['stale'])
  const d = entry(out, 'd')
  expect(d).toBeDefined()
  expect(d!).toMatch(/^paused/)
  expect(d!).toContain('#a')
  expect(d!).toContain('postponed')
  for (const id of ['a', 'b', 'c', 'd']) expect(mark(p, id)).not.toBe('stale')
  expect(out).not.toMatch(/^stale/m)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', () => {
  p = projectWith(
    ...['a', 'b', 'c'].flatMap((id) => realCard(id, `Card ${id.toUpperCase()}`, { status: 'decided' })),
    linked('c', 'a', 'depends_on'),
    linked('c', 'b', 'refines'),
  )
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  expect(mark(p, 'c')).toBe('stale')
  const c = entry(ok(p, ['stale']), 'c')
  expect(c).toBeDefined()
  expect(c!).toMatch(/^stale/)
  expect(c!).toMatch(/rejected #b/)
})

test('65.4 Rederive clears the mark on one card and leaves the others', () => {
  p = projectWith(
    ...['a', 'b', 'c'].flatMap((id) => realCard(id, `Card ${id.toUpperCase()}`, { status: 'decided' })),
    linked('b', 'a', 'depends_on'),
    linked('c', 'a', 'depends_on'),
  )
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  const before = ok(p, ['stale'])
  expect(entry(before, 'b')).toMatch(/^stale/)
  expect(entry(before, 'c')).toMatch(/^stale/)
  ok(p, ['rederive', 'b', 'confirm', '--why', 'b holds'])
  const out = ok(p, ['stale'])
  expect(entry(out, 'b')).toBeUndefined()
  const c = entry(out, 'c')
  expect(c).toMatch(/^stale/)
  expect(c!).toMatch(/rejected #a/)
  expect(mark(p, 'b')).toBeUndefined()
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', () => {
  p = projectWith(
    ...['a', 'b', 'c'].flatMap((id) => realCard(id, `Card ${id.toUpperCase()}`, { status: 'decided' })),
    linked('b', 'a', 'depends_on'),
    linked('c', 'b', 'depends_on'),
  )
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(mark(p, 'b')).toBe('paused')
  expect(mark(p, 'c')).toBe('paused')
  ok(p, ['status', 'a', 'decided'])
  expect(mark(p, 'b')).toBeUndefined()
  expect(mark(p, 'c')).toBeUndefined()
  const out = ok(p, ['stale'])
  expect(out).not.toContain('#b')
  expect(out).not.toContain('#c')
  expect(ok(p, ['show', 'c'])).toContain('status: decided')
})
