/** Held-out steps 87.1, 87.3, 87.5, 88.2 - 88.5: the merge loop, run as a process with fake agents. */
import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const MAKEFILE = 'check:\n\t@true\n'

const ticketOf = (number: number): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
})

const werkDir = () => join(p.dir, '.werk')
const board = () => join(werkDir(), 'board.jsonl')
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()

function appendBoard(...events: NewBoardEvent[]) {
  for (const e of events) appendFileSync(board(), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}

function project(tickets: number[], fields: Record<number, Partial<TicketFields>> = {}) {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  writeFileSync(join(p.dir, 'notes.txt'), 'notes\n')
  p.run(['git', 'add', 'Makefile', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(werkDir(), 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werkDir(), 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board(), '')
  appendBoard(...tickets.map((n): NewBoardEvent => ({ type: 'ticket.planned', payload: { ...ticketOf(n), ...fields[n] } })))
}

const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const binder = (bindings: Record<string, 'true' | 'false'>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const script = (builder: FakeReply[], binders: FakeReply[]) =>
  p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': author, 'heldout-binder': binders } })
const greenBinder = (tickets: number[]) => [binder(Object.fromEntries(tickets.map((n) => [`${n}.1`, 'true' as const])))]

const events = () => readLog<BoardEvent>(board())
const columnAt = (number: number, upTo: BoardEvent[]) => foldBoard(upTo).columns.find((c) => c.tickets.some((t) => t.number === number))?.name
const columnOf = (number: number) => columnAt(number, events())
const movesOf = (number: number) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === number ? [e.payload.to] : []))
const gates = () => events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
/** The board as it stood after each event of the log. */
const snapshots = () => {
  const all = events()
  return all.map((_, i) => all.slice(0, i + 1))
}
const inColumn = (upTo: BoardEvent[], name: string) => foldBoard(upTo).columns.find((c) => c.name === name)?.tickets.map((t) => t.number) ?? []
const moveAt = (number: number, to: string) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === number && e.payload.to === to)
const isSubsequence = (needle: string[], hay: string[]) => {
  let i = 0
  for (const h of hay) if (h === needle[i]) i++
  return i === needle.length
}

test('87.1 Two green tickets merge onto the main line one after the other', () => {
  project([1, 2])
  script([writes('t1.txt'), writes('t2.txt')], greenBinder([1, 2]))
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  // Then the board shows each ticket move through building, merging, and done
  for (const n of [1, 2]) {
    expect(isSubsequence(['building', 'merging', 'done'], movesOf(n))).toBe(true)
    expect(columnOf(n)).toBe('done')
  }
  // And the main line history shows the first ticket's merge before the second ticket's merge
  const doneOrder = [1, 2].toSorted((a, b) => moveAt(a, 'done') - moveAt(b, 'done'))
  const merges = git('log', '--first-parent', '--reverse', '--format=%s', 'main')
    .split('\n')
    .filter((s) => s.startsWith('werk: merge ticket'))
    .map((s) => Number(/werk: merge ticket (\d+)/.exec(s)![1]))
  expect(merges).toEqual(doneOrder)
  // And the repository has no new branch besides the main line and the ticket branches
  const branches = git('branch', '--format=%(refname:short)').split('\n')
  expect(branches.filter((b) => !b.startsWith('werk-build/'))).toEqual(['main'])
  expect(branches.filter((b) => b.startsWith('werk-build/'))).toHaveLength(2)
  // And no ticket card on the board shows a held-out badge
  const tickets = foldBoard(events()).columns.flatMap((c) => c.tickets)
  expect(tickets.every((t) => t.followUps.length === 0)).toBe(true)
}, 60_000)

test('87.3 A merge moves a clean checkout of the main line and stops at a checkout with a blocking local change', () => {
  project([1])
  script([writes('notes.txt', 'ticket one\n')], greenBinder([1]))
  expect(p.werk(['run', 'root']).code).toBe(0)
  // Then the checked-out folder shows the ticket's change without any action from the person
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('ticket one\n')
  expect(columnOf(1)).toBe('done')

  // When the person edits that same file in the checked-out folder without committing
  writeFileSync(join(p.dir, 'notes.txt'), 'my own edit\n')
  appendBoard({ type: 'ticket.planned', payload: ticketOf(2) })
  const tip = git('rev-parse', 'main')
  script([writes('notes.txt', 'ticket two\n')], greenBinder([1, 2]))
  const r = p.werk(['run', 'root'])
  // And a second ticket that changes the same file reaches merging with green checks
  expect(movesOf(2)).toContain('merging')
  // Then the merge stops and the board shows the second ticket did not reach done
  expect(r.code).not.toBe(0)
  expect(columnOf(2)).not.toBe('done')
  // And the main line tip is the same commit as before
  expect(git('rev-parse', 'main')).toBe(tip)
  // And the person's uncommitted edit is still in the file
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
}, 60_000)

test('87.5 G2 opens after the last merge with all held-out steps green and opens again after a later merge', () => {
  project([1, 2])
  script([writes('t1.txt'), writes('t2.txt')], [binder({ '1.1': 'true' }), binder({ '1.1': 'true', '2.1': 'true' })])
  const r = p.werk(['run', 'root', '--parallel', '1'])
  expect(r.code).toBe(0)
  // When the first ticket merges, Then G2 is not open for the subtree
  const all = events()
  const firstDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const firstRan = all.findIndex((e, i) => i > firstDone && e.type === 'heldout.ran')
  const secondDone = all.findIndex((e, i) => i > firstDone && e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(firstDone).toBeGreaterThanOrEqual(0)
  expect(all.slice(0, secondDone).filter((e) => e.type === 'gate.opened')).toEqual([])
  expect(firstRan).toBeGreaterThan(firstDone)
  // When the second ticket merges and every held-out step is green, Then G2 opens for the current tip
  const tip1 = git('rev-parse', 'main')
  const lastRan = all.filter((e) => e.type === 'heldout.ran').at(-1)!
  expect((lastRan.payload as { steps: { result: string }[] }).steps.every((s) => s.result === 'green')).toBe(true)
  expect(gates()).toEqual([tip1])

  // When the person approves G2: the product must give the person a way to approve it.
  const approve = p.werk(['approve', 'root'])
  const approveViaGate = p.werk(['gate', 'root', '--approve'])

  // ... and a new ticket of the same subtree later merges with every held-out step green
  appendBoard({ type: 'ticket.planned', payload: ticketOf(3) })
  script([writes('t3.txt')], [binder({ '1.1': 'true', '2.1': 'true', '3.1': 'true' })])
  const again = p.werk(['run', 'root'])
  expect(again.code).toBe(0)
  const tip2 = git('rev-parse', 'main')
  // Then G2 opens again for the new tip of the main line
  expect(tip2).not.toBe(tip1)
  expect(gates()).toEqual([tip1, tip2])

  // The approve step itself: there must be an approve action that succeeds.
  expect({ approve: approve.code, approveViaGate: approveViaGate.code }).toEqual(
    expect.objectContaining(approve.code === 0 ? { approve: 0 } : { approveViaGate: 0 }),
  )
}, 90_000)

test('88.2 Four unblocked tickets with distinct modules build three at a time', () => {
  project([1, 2, 3, 4])
  script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt'), writes('t4.txt')], greenBinder([1, 2, 3, 4]))
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots()
  // Then three tickets show in building at the same time, And the fourth ticket stays in ready
  const three = snaps.find((s) => inColumn(s, 'building').length === 3)
  expect(three).toBeDefined()
  const building = inColumn(three!, 'building')
  const fourth = [1, 2, 3, 4].find((n) => !building.includes(n))!
  expect(inColumn(three!, 'ready')).toEqual([fourth])
  expect(snaps.every((s) => inColumn(s, 'building').length <= 3)).toBe(true)
  // When one of the three building tickets merges and shows in done, Then the fourth ticket moves to building
  const firstDone = moveAt(building[0]!, 'done') >= 0 ? Math.min(...building.map((n) => moveAt(n, 'done')).filter((i) => i >= 0)) : -1
  const firstDoneTicket = building.find((n) => moveAt(n, 'done') === firstDone)!
  expect(moveAt(fourth, 'building')).toBeGreaterThan(firstDone)
  // And the fourth ticket's build contains the change of the merged ticket
  const base = new RegExp(`building ${fourth} Ticket ${fourth} on (werk-build/\\S+), from main at (\\w+)`).exec(r.stdout)
  expect(base).not.toBeNull()
  const fourthBranch = base![1]!.replace(/,$/, '')
  const mergeOfFirst = git('log', '--first-parent', '--format=%H %s', 'main')
    .split('\n')
    .find((l) => l.includes(`werk: merge ticket ${firstDoneTicket} `))!
    .split(' ')[0]!
  expect(p.run(['git', 'merge-base', '--is-ancestor', mergeOfFirst, fourthBranch]).code).toBe(0)
}, 90_000)

test('88.3 Two tickets that touch a common module never build at the same time', () => {
  project([1, 2, 3], { 1: { touches: ['decision log'] }, 2: { touches: ['decision log'] }, 3: { touches: ['map view'] } })
  script([writes('t1.txt'), writes('t3.txt'), writes('t2.txt')], greenBinder([1, 2, 3]))
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots()
  // Then one of the two "decision log" tickets and the "map view" ticket show in building
  const both = snaps.find((s) => {
    const b = inColumn(s, 'building')
    return b.includes(3) && (b.includes(1) || b.includes(2))
  })
  expect(both).toBeDefined()
  const first = inColumn(both!, 'building').includes(1) ? 1 : 2
  const other = first === 1 ? 2 : 1
  // And the other "decision log" ticket stays in ready
  expect(inColumn(both!, 'ready')).toContain(other)
  // When the first "decision log" ticket merges and shows in done, Then the other moves to building
  expect(moveAt(first, 'done')).toBeGreaterThanOrEqual(0)
  expect(moveAt(other, 'building')).toBeGreaterThan(moveAt(first, 'done'))
  // And at no time during the run do both "decision log" tickets show in building
  expect(snaps.some((s) => inColumn(s, 'building').includes(1) && inColumn(s, 'building').includes(2))).toBe(false)
}, 90_000)

test('88.4 A ticket waits until its blocker is merged', () => {
  project([1, 2], { 2: { blockedBy: [1] } })
  script([writes('t1.txt'), writes('t2.txt')], greenBinder([1, 2]))
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots()
  // Then ticket 1 shows in building
  expect(snaps.some((s) => inColumn(s, 'building').includes(1))).toBe(true)
  // And ticket 2 does not show in building while ticket 1 is in building or merging
  expect(snaps.some((s) => inColumn(s, 'building').includes(2) && ['building', 'merging'].includes(columnAt(1, s)!))).toBe(false)
  // When ticket 1 shows in done, Then ticket 2 moves to building
  expect(moveAt(1, 'done')).toBeGreaterThanOrEqual(0)
  expect(moveAt(2, 'building')).toBeGreaterThan(moveAt(1, 'done'))
}, 90_000)

test('88.5 The merge queue merges one ticket at a time while three build', () => {
  project([1, 2, 3])
  script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], greenBinder([1, 2, 3]))
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const snaps = snapshots()
  // And all three tickets finish their builds (all three were in building together)
  expect(snaps.some((s) => inColumn(s, 'building').length === 3)).toBe(true)
  // Then at most one ticket shows in merging at any time
  expect(Math.max(...snaps.map((s) => inColumn(s, 'merging').length))).toBe(1)
  // And all three tickets end in done
  for (const n of [1, 2, 3]) expect(columnOf(n)).toBe('done')
}, 90_000)
