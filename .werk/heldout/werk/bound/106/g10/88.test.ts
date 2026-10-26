/** Held-out steps 88.2 to 88.5: the scheduler of the merge loop. */
import { test } from 'bun:test'
import { author, binder, expect, judges, setup, snapshots, ticketOf, writes } from './helpers.ts'

const GREEN_CHECK = 'check:\n\t@true\n'
const greenBinder = (ids: number[]) => [binder(Object.fromEntries(ids.map((n) => [`${n}.1`, 'true'])))]
const buildingAt = (s: Map<number, string>) => [...s].filter(([, col]) => col === 'building').map(([n]) => n)

test('88.2 four unblocked tickets with distinct modules build three at a time', () => {
  const c = setup(GREEN_CHECK, [1, 2, 3, 4].map((n) => ticketOf(n)))
  c.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t-a.txt'), writes('t-b.txt'), writes('t-c.txt'), writes('t-d.txt')], 'heldout-author': author, 'heldout-binder': greenBinder([1, 2, 3, 4]) },
  })
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots(c.events())
  // Three tickets show in building at the same time, and the fourth stays in ready then.
  const three = snaps.find((s) => buildingAt(s).length === 3)
  expect(three).toBeDefined()
  expect([1, 2, 3, 4].filter((n) => three!.get(n) === 'ready')).toEqual([4])
  expect(snaps.every((s) => buildingAt(s).length <= 3)).toBe(true)
  // The fourth moves to building only after one of the three shows in done.
  expect(c.moveAt(4, 'building')).toBeGreaterThan(c.firstMove('done'))
  // The fourth ticket's build holds the change of the merged ticket.
  const firstDone = c.events()[c.firstMove('done')]!
  const mergedFirst = firstDone.type === 'ticket.moved' ? firstDone.payload.number : 0
  const branch4 = new RegExp(`building 4 Ticket 4 on (werk-build/\\S+),`).exec(r.stdout)?.[1]
  expect(branch4).toBeDefined()
  const mergeSubjects = c.git('log', '--format=%s', branch4!).split('\n')
  expect(mergeSubjects.some((s) => s.startsWith(`werk: merge ticket ${mergedFirst} `))).toBe(true)
}, 90_000)

test('88.3 two tickets that touch a common module never build at the same time', () => {
  const c = setup(GREEN_CHECK, [
    ticketOf(1, { touches: ['decision log'] }),
    ticketOf(2, { touches: ['decision log'] }),
    ticketOf(3, { touches: ['map view'] }),
  ])
  c.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t-a.txt'), writes('t-b.txt'), writes('t-c.txt')], 'heldout-author': author, 'heldout-binder': greenBinder([1, 2, 3]) },
  })
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots(c.events())
  // One "decision log" ticket and the "map view" ticket build together; the other waits in ready.
  const together = snaps.find((s) => s.get(3) === 'building' && (s.get(1) === 'building' || s.get(2) === 'building'))
  expect(together).toBeDefined()
  const firstDl = together!.get(1) === 'building' ? 1 : 2
  const otherDl = firstDl === 1 ? 2 : 1
  expect(together!.get(otherDl)).toBe('ready')
  // The other starts once the first is done.
  expect(c.moveAt(otherDl, 'building')).toBeGreaterThan(c.moveAt(firstDl, 'done'))
  // Never both at once.
  expect(snaps.some((s) => s.get(1) === 'building' && s.get(2) === 'building')).toBe(false)
}, 90_000)

test('88.4 a ticket waits until its blocker is merged', () => {
  const c = setup(GREEN_CHECK, [ticketOf(1), ticketOf(2, { blockedBy: [1] })])
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t-a.txt'), writes('t-b.txt')], 'heldout-author': author, 'heldout-binder': greenBinder([1, 2]) } })
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots(c.events())
  expect(snaps.some((s) => s.get(1) === 'building')).toBe(true)
  expect(snaps.some((s) => (s.get(1) === 'building' || s.get(1) === 'merging') && s.get(2) === 'building')).toBe(false)
  expect(c.moveAt(1, 'done')).toBeGreaterThanOrEqual(0)
  expect(c.moveAt(2, 'building')).toBeGreaterThan(c.moveAt(1, 'done'))
}, 90_000)

test('88.5 the merge queue merges one ticket at a time while three build', () => {
  const c = setup(GREEN_CHECK, [1, 2, 3].map((n) => ticketOf(n)))
  c.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t-a.txt'), writes('t-b.txt'), writes('t-c.txt')], 'heldout-author': author, 'heldout-binder': greenBinder([1, 2, 3]) },
  })
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots(c.events())
  expect(snaps.some((s) => buildingAt(s).length === 3)).toBe(true)
  expect(snaps.every((s) => [...s.values()].filter((col) => col === 'merging').length <= 1)).toBe(true)
  for (const n of [1, 2, 3]) expect(c.columnOf(n)).toBe('done')
}, 90_000)
