/** Held-out steps 88.2 to 88.5: the merge loop's scheduler and merge queue, seen through the board log. */
import { afterEach, expect, test } from 'bun:test'
import { foldBoard } from '../../src/board/fold.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { boardEvents, git, movesOf, runProject, runScript, ticketOf, writes } from './lib.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

/** The columns of every ticket after each prefix of the board log: what the board shows at each moment. */
function moments(dir: string) {
  const events = boardEvents(dir)
  return events.map((_, i) => {
    const b = foldBoard(events.slice(0, i + 1))
    return Object.fromEntries(b.columns.flatMap((c) => c.tickets.map((t) => [t.number, c.name])))
  })
}
const inCol = (m: Record<number, string>, col: string) => Object.entries(m).filter(([, c]) => c === col).map(([n]) => Number(n))
const firstMoment = (ms: Record<number, string>[], ok: (m: Record<number, string>) => boolean) => ms.findIndex(ok)

test('88.2 four unblocked tickets with distinct modules build three at a time', () => {
  p = makeProject()
  runProject(p.dir, [1, 2, 3, 4].map((n) => ticketOf(n)))
  p.scriptAgent(runScript([writes('t1.txt'), writes('t2.txt'), writes('t3.txt'), writes('t4.txt')], [1, 2, 3, 4]))
  const r = p.werk(['run', 'root'])
  const ms = moments(p.dir)
  // Three tickets show in building at the same time, and the fourth stays in ready.
  const three = firstMoment(ms, (m) => inCol(m, 'building').length === 3)
  expect(three, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBeGreaterThanOrEqual(0)
  const fourth = [1, 2, 3, 4].find((n) => !inCol(ms[three]!, 'building').includes(n))!
  expect(ms[three]![fourth]).toBe('ready')
  // The fourth stays in ready until one of the three is done.
  const fourthBuilding = firstMoment(ms, (m) => m[fourth] === 'building')
  const firstDone = firstMoment(ms, (m) => inCol(m, 'done').length > 0)
  expect(firstDone).toBeGreaterThanOrEqual(0)
  expect(fourthBuilding).toBeGreaterThan(firstDone)
  const merged = inCol(ms[firstDone]!, 'done')[0]!
  // The fourth ticket's build contains the change of the merged ticket.
  const base = new RegExp(`building ${fourth} Ticket ${fourth} on (werk-build/\\S+), from main at (\\w+)`).exec(r.stdout)
  expect(base, r.stdout).not.toBeNull()
  const branch = base![1]!.replace(/,$/, '')
  expect(git(p.dir, 'show', `${branch}:t${merged}.txt`)).toBeDefined()
  for (const n of [1, 2, 3, 4]) expect(ms.at(-1)![n]).toBe('done')
}, 90_000)

test('88.3 two tickets that touch a common module never build at the same time', () => {
  p = makeProject()
  runProject(p.dir, [ticketOf(1, { touches: ['decision log'] }), ticketOf(2, { touches: ['decision log'] }), ticketOf(3, { touches: ['map view'] })])
  p.scriptAgent(runScript([writes('a.txt'), writes('b.txt'), writes('c.txt')], [1, 2, 3]))
  const r = p.werk(['run', 'root'])
  const ms = moments(p.dir)
  const firstBuild = firstMoment(ms, (m) => inCol(m, 'building').length === 2)
  expect(firstBuild, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBeGreaterThanOrEqual(0)
  const building = inCol(ms[firstBuild]!, 'building')
  expect(building).toContain(3)
  const firstLog = building.find((n) => n !== 3)!
  const other = firstLog === 1 ? 2 : 1
  expect(ms[firstBuild]![other]).toBe('ready')
  const firstDone = firstMoment(ms, (m) => m[firstLog] === 'done')
  const otherBuilding = firstMoment(ms, (m) => m[other] === 'building')
  expect(otherBuilding).toBeGreaterThan(firstDone)
  // At no moment do both "decision log" tickets show in building.
  expect(ms.some((m) => m[1] === 'building' && m[2] === 'building')).toBe(false)
  for (const n of [1, 2, 3]) expect(ms.at(-1)![n]).toBe('done')
}, 90_000)

test('88.4 a ticket waits until its blocker is merged', () => {
  p = makeProject()
  runProject(p.dir, [ticketOf(1, { touches: ['map view'] }), ticketOf(2, { touches: ['decision log'], blockedBy: [1] })])
  p.scriptAgent(runScript([writes('a.txt'), writes('b.txt')], [1, 2]))
  const r = p.werk(['run', 'root'])
  const ms = moments(p.dir)
  expect(firstMoment(ms, (m) => m[1] === 'building'), `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBeGreaterThanOrEqual(0)
  expect(ms.some((m) => m[2] === 'building' && (m[1] === 'building' || m[1] === 'merging'))).toBe(false)
  const oneDone = firstMoment(ms, (m) => m[1] === 'done')
  expect(oneDone).toBeGreaterThanOrEqual(0)
  expect(firstMoment(ms, (m) => m[2] === 'building')).toBeGreaterThan(oneDone)
}, 90_000)

test('88.5 the merge queue merges one ticket at a time while three build', () => {
  p = makeProject()
  runProject(p.dir, [1, 2, 3].map((n) => ticketOf(n)))
  p.scriptAgent(runScript([writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], [1, 2, 3]))
  const r = p.werk(['run', 'root'])
  const ms = moments(p.dir)
  expect(ms.some((m) => inCol(m, 'building').length === 3), `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(true)
  for (const n of [1, 2, 3]) expect(movesOf(p.dir, n)).toContain('merging')
  const most = Math.max(...ms.map((m) => inCol(m, 'merging').length))
  expect(most).toBeLessThanOrEqual(1)
  for (const n of [1, 2, 3]) expect(ms.at(-1)![n]).toBe('done')
}, 90_000)
