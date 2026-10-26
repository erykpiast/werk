/** Held-out steps 88.1 - 88.5: the merge loop schedules builds. */
import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
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

const ticketOf = (number: number, fields: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...fields,
})
const werkDir = () => join(p.dir, '.werk')
const board = () => join(werkDir(), 'board.jsonl')
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()

function project(tickets: TicketFields[]) {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@true\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(werkDir(), 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werkDir(), 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board(), '')
  for (const t of tickets) {
    const e: NewBoardEvent = { type: 'ticket.planned', payload: t }
    appendFileSync(board(), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
  }
}

const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
/** Each builder launch writes a file named after its launch, with a short sleep so builds overlap. */
const writes = (path: string): FakeReply => ({ steps: [{ sleep: 300 }, { edit: { path, content: `${path}\n` } }, ...reply({}).steps] })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees it'
const script = (builds: number, steps: string[]) =>
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: Array.from({ length: builds }, (_, i) => writes(`b${i + 1}.txt`)),
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': [reply({ steps: steps.map((id) => ({ id, cmd: 'true' })) })],
    },
  })

const events = () => readLog<BoardEvent>(board())
/** The fold after each prefix of the board log. */
const states = () => {
  const all = events()
  return all.map((_, i) => foldBoard(all.slice(0, i + 1)).columns.flatMap((c) => c.tickets))
}
const inColumn = (state: ReturnType<typeof states>[number], column: string) => state.filter((t) => t.column === column).map((t) => t.number)
const moveAt = (n: number, to: string) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)

test('88.1 nothing builds before the person starts the run', async () => {
  project([1, 2, 3].map((n) => ticketOf(n)))
  script(3, ['1.1', '2.1', '3.1'])
  // The person opens the board and waits.
  await Bun.sleep(2000)
  const before = foldBoard(events()).columns
  expect(before.find((c) => c.name === 'ready')!.tickets.map((t) => t.number)).toEqual([1, 2, 3])
  expect(before.find((c) => c.name === 'building')!.tickets).toHaveLength(0)
  expect(p.agentLaunches()).toHaveLength(0)

  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  for (const n of [1, 2, 3]) expect(moveAt(n, 'building')).toBeGreaterThanOrEqual(0)
}, 60_000)

test('88.2 four unblocked tickets with distinct modules build three at a time', () => {
  project([1, 2, 3, 4].map((n) => ticketOf(n)))
  script(4, ['1.1', '2.1', '3.1', '4.1'])
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const s = states()
  const three = s.findIndex((st) => inColumn(st, 'building').length === 3)
  expect(three).toBeGreaterThanOrEqual(0)
  expect(inColumn(s[three]!, 'building').toSorted()).toEqual([1, 2, 3])
  expect(inColumn(s[three]!, 'ready')).toEqual([4])
  // Never more than three in building.
  expect(Math.max(...s.map((st) => inColumn(st, 'building').length))).toBe(3)
  const firstDone = events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const doneTicket = (events()[firstDone] as Extract<BoardEvent, { type: 'ticket.moved' }>).payload.number
  expect(moveAt(4, 'building')).toBeGreaterThan(firstDone)
  const base = /building 4 Ticket 4 on werk-build\/\S+, from main at (\w+)/.exec(r.stdout)?.[1]
  expect(base).toBeDefined()
  expect(git('log', '--format=%s', base!).split('\n').some((l) => l.startsWith(`werk: merge ticket ${doneTicket} `))).toBe(true)
}, 90_000)

test('88.3 two tickets that touch a common module never build at the same time', () => {
  project([ticketOf(1, { touches: ['decision log'] }), ticketOf(2, { touches: ['decision log'] }), ticketOf(3, { touches: ['map view'] })])
  script(3, ['1.1', '2.1', '3.1'])
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const s = states()
  const pair = s.findIndex((st) => inColumn(st, 'building').length === 2)
  expect(pair).toBeGreaterThanOrEqual(0)
  const building = inColumn(s[pair]!, 'building')
  expect(building).toContain(3)
  const first = building.find((n) => n !== 3)!
  const other = first === 1 ? 2 : 1
  expect([1, 2]).toContain(first)
  expect(inColumn(s[pair]!, 'ready')).toContain(other)
  expect(moveAt(other, 'building')).toBeGreaterThan(moveAt(first, 'done'))
  for (const st of s) {
    const b = inColumn(st, 'building')
    expect(b.includes(1) && b.includes(2)).toBe(false)
  }
}, 90_000)

test('88.4 a ticket waits until its blocker is merged', () => {
  project([ticketOf(1), ticketOf(2, { blockedBy: [1] })])
  script(2, ['1.1', '2.1'])
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(moveAt(1, 'building')).toBeGreaterThanOrEqual(0)
  for (const st of states()) {
    const one = st.find((t) => t.number === 1)?.column
    const two = st.find((t) => t.number === 2)?.column
    if (one === 'building' || one === 'merging') expect(two).not.toBe('building')
  }
  expect(moveAt(2, 'building')).toBeGreaterThan(moveAt(1, 'done'))
}, 90_000)

test('88.5 the merge queue merges one ticket at a time while three build', () => {
  project([1, 2, 3].map((n) => ticketOf(n)))
  script(3, ['1.1', '2.1', '3.1'])
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const s = states()
  expect(Math.max(...s.map((st) => inColumn(st, 'building').length))).toBe(3)
  for (const st of s) expect(inColumn(st, 'merging').length).toBeLessThanOrEqual(1)
  const last = s.at(-1)!
  expect(inColumn(last, 'done').toSorted()).toEqual([1, 2, 3])
}, 90_000)
