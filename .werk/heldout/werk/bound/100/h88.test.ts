/** Held-out steps 88.2–88.5 (88.1 is the browser spec h88.spec.ts): the scheduler of the merge loop. */
import { afterEach, expect, test } from 'bun:test'
import { greenBinder, setup, writes, type Ctx } from './hrun-common.ts'

let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c = undefined
})

const building = (cols: Map<number, string>) => [...cols].filter(([, col]) => col === 'building').map(([n]) => n)

// 88.2 Scenario: Four unblocked tickets with distinct modules build three at a time
// Given a plan run with four unblocked tickets whose touches lines name four different modules
// When the person starts the merge loop on the plan run
// Then three tickets show in building at the same time
// And the fourth ticket stays in ready
// When one of the three building tickets merges and shows in done
// Then the fourth ticket moves to building
// And the fourth ticket's build contains the change of the merged ticket
test('88.2 four unblocked tickets with distinct modules build three at a time', () => {
  c = setup([1, 2, 3, 4])
  c.script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt'), writes('t4.txt')], greenBinder([1, 2, 3, 4]))
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const h = c.history()
  const three = h.find((cols) => building(cols).length === 3)
  expect(three).toBeDefined()
  const four = building(three!)
  const fourth = [1, 2, 3, 4].find((n) => !four.includes(n))!
  expect(three!.get(fourth)).toBe('ready')
  expect(h.every((cols) => building(cols).length <= 3)).toBe(true)
  const firstDone = c.events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const doneTicket = (c.events()[firstDone]!.payload as { number: number }).number
  expect(four).toContain(doneTicket)
  expect(c.moveAt(fourth, 'building')).toBeGreaterThan(firstDone)
  const base = new RegExp(`building ${fourth} Ticket ${fourth} on werk-build/\\S+, from main at (\\w+)`).exec(r.stdout)?.[1]
  expect(base).toBeDefined()
  expect(c.git('show', `${base}:t${doneTicket}.txt`)).toBe(`t${doneTicket}.txt`)
}, 90_000)

// 88.3 Scenario: Two tickets that touch a common module never build at the same time
test('88.3 two tickets that touch a common module never build at the same time', () => {
  c = setup([1, 2, 3], { 1: { touches: ['decision log'] }, 2: { touches: ['decision log'] }, 3: { touches: ['map view'] } })
  c.script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], greenBinder([1, 2, 3]))
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const h = c.history()
  // Never both decision log tickets in building.
  expect(h.every((cols) => !(cols.get(1) === 'building' && cols.get(2) === 'building'))).toBe(true)
  // One decision log ticket and the map view ticket build together, the other waits in ready.
  const together = h.find((cols) => cols.get(3) === 'building' && (cols.get(1) === 'building' || cols.get(2) === 'building'))
  expect(together).toBeDefined()
  const first = together!.get(1) === 'building' ? 1 : 2
  const other = first === 1 ? 2 : 1
  expect(together!.get(other)).toBe('ready')
  expect(c.moveAt(other, 'building')).toBeGreaterThan(c.moveAt(first, 'done'))
  expect(c.movesOf(other)).toContain('building')
}, 90_000)

// 88.4 Scenario: A ticket waits until its blocker is merged
test('88.4 a ticket waits until its blocker is merged', () => {
  c = setup([1, 2], { 1: { touches: ['map view'] }, 2: { blockedBy: [1], touches: ['decision log'] } })
  c.script([writes('t1.txt'), writes('t2.txt')], greenBinder([1, 2]))
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const h = c.history()
  expect(h.some((cols) => cols.get(1) === 'building')).toBe(true)
  expect(h.every((cols) => !(cols.get(2) === 'building' && (cols.get(1) === 'building' || cols.get(1) === 'merging')))).toBe(true)
  expect(c.moveAt(1, 'done')).toBeGreaterThanOrEqual(0)
  expect(c.moveAt(2, 'building')).toBeGreaterThan(c.moveAt(1, 'done'))
}, 90_000)

// 88.5 Scenario: The merge queue merges one ticket at a time while three build
test('88.5 the merge queue merges one ticket at a time while three build', () => {
  c = setup([1, 2, 3])
  c.script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], greenBinder([1, 2, 3]))
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const h = c.history()
  expect(h.some((cols) => building(cols).length === 3)).toBe(true)
  expect(h.every((cols) => [...cols.values()].filter((col) => col === 'merging').length <= 1)).toBe(true)
  for (const n of [1, 2, 3]) expect(h.at(-1)!.get(n)).toBe('done')
}, 90_000)
