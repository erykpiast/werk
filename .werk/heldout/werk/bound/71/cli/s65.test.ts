import { afterEach, expect, test } from 'bun:test'
import { decide, makeProject, ok, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

/** A real decided card. With `on`, it depends on that card instead of a no-basis reason. */
const card = (id: string, on?: string, extra: string[] = []) => {
  ok(p, ['add', id, '--title', `Card ${id.toUpperCase()}`, ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
  if (on) ok(p, ['link', id, on, '--type', 'depends_on'])
  decide(p, id, { basis: on !== undefined || extra.includes('--parent') })
}
const stale = () => p.werk(['stale']).stdout
/** The block of the stale list for one card: its head line and its trace lines. */
const entry = (id: string) => {
  const lines = stale().split('\n')
  const i = lines.findIndex((l) => new RegExp(`^(stale|paused)\\s+#${id}\\s`).test(l))
  if (i === -1) return undefined
  const rest = lines.slice(i + 1)
  const end = rest.findIndex((l) => !l.startsWith('  '))
  return [lines[i]!, ...rest.slice(0, end === -1 ? undefined : end)].join('\n')
}
/** The map (the graph JSON the server sends, and show) carries no mark field; the stale list is where marks show. */
const markOf = (id: string) => /^(stale|paused)/.exec(entry(id) ?? '')?.[1]

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = makeProject()
  card('a'); card('b', 'a'); card('c', 'b')
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  expect(markOf('b')).toBe('stale')
  const b = entry('b')!
  expect(b).toContain('#a')
  expect(b).toContain('depends_on')
  expect(b).toContain('rejected')
  expect(entry('c')).toBeUndefined()
  expect(show(p, 'c')).not.toMatch(/stale|paused/)
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = makeProject()
  card('a'); card('b', 'a'); card('c', 'b'); card('d', 'c')
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['b', 'c', 'd']) expect(markOf(id)).toBe('paused')
  expect(show(p, 'd')).toContain('status: decided')
  const d = entry('d')!
  expect(d).toContain('#a')
  expect(d).toContain('postponed')
  expect(stale()).not.toMatch(/^stale\s/m)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = makeProject()
  card('a'); card('b')
  ok(p, ['add', 'c', '--title', 'Card C', '--parent', 'b'])
  ok(p, ['accept', 'c', '--actor', 'you'])
  ok(p, ['link', 'c', 'a', '--type', 'depends_on'])
  decide(p, 'c', { basis: true })
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  expect(markOf('c')).toBe('stale')
  expect(entry('c')).toMatch(/rejected #b/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = makeProject()
  card('a'); card('b', 'a'); card('c', 'a')
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  expect(markOf('b')).toBe('stale')
  expect(markOf('c')).toBe('stale')
  ok(p, ['rederive', 'b', 'confirm', '--why', 'still holds'])
  expect(entry('b')).toBeUndefined()
  expect(markOf('c')).toBe('stale')
  expect(entry('c')).toMatch(/rejected #a/)
  expect(show(p, 'b')).not.toMatch(/stale/)
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = makeProject()
  card('a'); card('b', 'a'); card('c', 'b')
  const statusBefore = /status: \w+/.exec(show(p, 'c'))![0]
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(markOf('b')).toBe('paused')
  expect(markOf('c')).toBe('paused')
  ok(p, ['status', 'a', 'decided'])
  expect(entry('b')).toBeUndefined()
  expect(entry('c')).toBeUndefined()
  expect(show(p, 'c')).toContain(statusBefore)
})
