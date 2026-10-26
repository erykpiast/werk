/** Held-out steps 87.x and 88.x: the merge loop of `werk run`, with the fake agent per role. */
import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, serveProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

// Green on a branch. On a detached tree (the merge queue's tree) red when the conflict pair is there.
const MAKEFILE = [
  'check:',
  '\t@if [ -f a.txt ] && [ -f b.txt ] && ! git symbolic-ref -q HEAD >/dev/null; then echo "MERGE-RED-MARK both a and b"; exit 1; fi',
  '',
].join('\n')

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
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const script = (builder: FakeReply[], binders: FakeReply[]) =>
  p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': author, 'heldout-binder': binders } })
const greenBinder = (tickets: number[]) => [binder(Object.fromEntries(tickets.map((n) => [`${n}.1`, 'true' as const])))]

const events = () => readLog<BoardEvent>(board())
const ticketsAt = (upTo: BoardEvent[]) => foldBoard(upTo).columns.flatMap((c) => c.tickets)
const columnOf = (n: number, upTo = events()) => ticketsAt(upTo).find((t) => t.number === n)?.column
const movesOf = (n: number) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
const moveAt = (n: number, to: string) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)
const gates = () => events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
const mainLine = () => git('log', '--first-parent', '--format=%s', 'main').split('\n')
const merges = () => mainLine().filter((s) => s.startsWith('werk: merge'))
/** The board as it was after each event of the board log. */
const everyState = () => {
  const all = events()
  return all.map((_, i) => ticketsAt(all.slice(0, i + 1)))
}

test('87.1 two green tickets merge onto the main line one after the other', () => {
  project([3, 4])
  const branchesBefore = git('branch', '--format=%(refname:short)').split('\n')
  script([writes('t3.txt'), writes('t4.txt')], greenBinder([3, 4]))
  const r = p.werk(['run', 'root'])
  console.log('87.1 run', r.code, r.stdout, r.stderr)
  expect(r.code).toBe(0)
  expect(movesOf(3)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(4)).toEqual(['building', 'merging', 'done'])
  const doneFirst = moveAt(3, 'done') < moveAt(4, 'done') ? 3 : 4
  const doneSecond = doneFirst === 3 ? 4 : 3
  const m = merges()
  // Newest first: the second ticket's merge is on top.
  expect(m[0]).toMatch(new RegExp(`^werk: merge ticket ${doneSecond}`))
  expect(m[1]).toMatch(new RegExp(`^werk: merge ticket ${doneFirst}`))
  const branches = git('branch', '--format=%(refname:short)').split('\n')
  const fresh = branches.filter((b) => !branchesBefore.includes(b))
  console.log('87.1 new branches', fresh)
  expect(fresh.every((b) => b.startsWith('werk-build/'))).toBe(true)
  expect(fresh).toHaveLength(2)
  for (const t of ticketsAt(events())) expect(t.followUps).toEqual([])
}, 60_000)

test('87.2 a ticket red on the merged tree goes back to building and the main line stays', async () => {
  project([1])
  script([writes('a.txt')], greenBinder([1]))
  expect(p.werk(['run', 'root']).code).toBe(0)
  expect(columnOf(1)).toBe('done')
  appendBoard({ type: 'ticket.planned', payload: ticketOf(2) })
  const tip = git('rev-parse', 'main')
  script([writes('b.txt')], greenBinder([1, 2]))
  const r = p.werk(['run', 'root', '--cap', '1'])
  console.log('87.2 run', r.code, r.stdout, r.stderr)
  expect(movesOf(2).slice(0, 3)).toEqual(['building', 'merging', 'building'])
  expect(git('rev-parse', 'main')).toBe(tip)
  // The drawer reads the board fold and the ticket's session from the server.
  const server = serveProject(p)
  const url = await server.url
  const session = (await (await fetch(`${url}api/board/2/session`)).json()) as { lines: { text: string }[] }
  const boardReply = await (await fetch(`${url}api/board`)).text()
  const drawerText = session.lines.map((l) => l.text).join('\n') + '\n' + boardReply
  console.log('87.2 drawer text', drawerText)
  expect(drawerText).toContain('make check')
  expect(drawerText).toContain('MERGE-RED-MARK')
}, 60_000)

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', () => {
  project([3])
  script([writes('notes.txt', 'ticket 3\n')], greenBinder([3]))
  expect(p.werk(['run', 'root']).code).toBe(0)
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('ticket 3\n')

  writeFileSync(join(p.dir, 'notes.txt'), 'my local work\n')
  appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  const tip = git('rev-parse', 'main')
  script([writes('notes.txt', 'ticket 4\n')], greenBinder([3, 4]))
  const r = p.werk(['run', 'root'])
  console.log('87.3 run', r.code, r.stdout, r.stderr)
  expect(moveAt(4, 'merging')).toBeGreaterThanOrEqual(0)
  expect(columnOf(4)).not.toBe('done')
  expect(git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('my local work\n')
}, 60_000)

test('87.4 a red held-out step after a merge files a follow-up and badges the done ticket', () => {
  project([3])
  script([writes('t3.txt'), writes('fix.txt')], [binder({ '3.1': 'false' }), binder({ '3.1': 'true', '4.1': 'true' })])
  const r = p.werk(['run', 'root'])
  console.log('87.4 run', r.code, r.stdout, r.stderr)
  const all = events()
  const filed = all.findIndex((e) => e.type === 'heldout.followup')
  expect(filed).toBeGreaterThanOrEqual(0)
  const then = ticketsAt(all.slice(0, filed + 1))
  const done = then.find((t) => t.number === 3)!
  expect(done.column).toBe('done')
  expect(merges().some((s) => s.startsWith('werk: merge ticket 3'))).toBe(true)
  const follow = then.find((t) => t.number !== 3)!
  expect(follow.column).toBe('ready')
  expect(`${follow.title}\n${follow.brief}`).toContain('STEP-MARK')
  expect(done.followUps).toEqual([follow.number])
}, 60_000)

test('87.5 G2 opens after the last merge, and again after a later merge once approved', () => {
  project([3, 4])
  script([writes('t3.txt'), writes('t4.txt')], greenBinder([3, 4]))
  const r = p.werk(['run', 'root', '--parallel', '1'])
  console.log('87.5 run', r.code, r.stdout, r.stderr)
  expect(r.code).toBe(0)
  const all = events()
  const firstDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const lastDone = all.findLastIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  // Between the first merge and the second merge, no G2 opened.
  expect(all.slice(0, lastDone).some((e) => e.type === 'gate.opened')).toBe(false)
  expect(firstDone).toBeLessThan(lastDone)
  expect(gates()).toEqual([git('rev-parse', 'main')])
  // The person approves G2: the product offers no approve verb or route.
  const help = p.werk(['help']).stdout
  console.log('87.5 help has approve?', /approve/i.test(help))
  expect(help).toMatch(/approve/i)
}, 60_000)

test('88.1 nothing builds before the person starts the run', async () => {
  project([1, 2, 3])
  await Bun.sleep(1500)
  expect(events().filter((e) => e.type === 'ticket.moved')).toEqual([])
  for (const n of [1, 2, 3]) expect(columnOf(n)).toBe('ready')
  script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], greenBinder([1, 2, 3]))
  const r = p.werk(['run', 'root'])
  console.log('88.1 run', r.code, r.stderr)
  for (const n of [1, 2, 3]) expect(movesOf(n)[0]).toBe('building')
}, 60_000)

test('88.2 four unblocked tickets with distinct modules build three at a time', () => {
  project([1, 2, 3, 4])
  script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt'), writes('t4.txt')], greenBinder([1, 2, 3, 4]))
  const r = p.werk(['run', 'root'])
  console.log('88.2 run', r.code, r.stdout, r.stderr)
  const states = everyState()
  const max = Math.max(...states.map((s) => s.filter((t) => t.column === 'building').length))
  expect(max).toBe(3)
  // At the moment three build, the fourth is still in ready.
  const at = states.findIndex((s) => s.filter((t) => t.column === 'building').length === 3)
  const waiting = states[at]!.find((t) => t.column === 'ready')
  expect(waiting).toBeDefined()
  const fourth = waiting!.number
  const firstDone = events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(moveAt(fourth, 'building')).toBeGreaterThan(firstDone)
  const mergedFirst = (events()[firstDone] as Extract<BoardEvent, { type: 'ticket.moved' }>).payload.number
  const base = new RegExp(`building ${fourth} Ticket ${fourth} on werk-build/\\S+, from main at (\\w+)`).exec(r.stdout)?.[1]
  expect(base).toBeDefined()
  expect(git('log', '--format=%s', base!).split('\n').some((s) => s.startsWith(`werk: merge ticket ${mergedFirst} `))).toBe(true)
}, 90_000)

test('88.3 two tickets that touch a common module never build at the same time', () => {
  project([1, 2, 3], { 1: { touches: ['decision log'] }, 2: { touches: ['decision log'] }, 3: { touches: ['map view'] } })
  script([writes('t1.txt'), writes('t3.txt'), writes('t2.txt')], greenBinder([1, 2, 3]))
  const r = p.werk(['run', 'root'])
  console.log('88.3 run', r.code, r.stderr)
  const states = everyState()
  expect(states.some((s) => s.filter((t) => [1, 2].includes(t.number) && t.column === 'building').length === 2)).toBe(false)
  const first = moveAt(1, 'building') < moveAt(2, 'building') || moveAt(2, 'building') < 0 ? 1 : 2
  const other = first === 1 ? 2 : 1
  const firstMerging = events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'merging')
  expect(moveAt(first, 'building')).toBeLessThan(firstMerging)
  expect(moveAt(3, 'building')).toBeLessThan(firstMerging)
  expect(moveAt(other, 'building')).toBeGreaterThan(moveAt(first, 'done'))
  expect(columnOf(other)).toBe('done')
}, 90_000)

test('88.4 a ticket waits until its blocker is merged', () => {
  project([1, 2], { 2: { blockedBy: [1] } })
  script([writes('t1.txt'), writes('t2.txt')], greenBinder([1, 2]))
  const r = p.werk(['run', 'root'])
  console.log('88.4 run', r.code, r.stderr)
  expect(moveAt(1, 'building')).toBeGreaterThanOrEqual(0)
  for (const s of everyState()) {
    const one = s.find((t) => t.number === 1)?.column
    const two = s.find((t) => t.number === 2)?.column
    if (one === 'building' || one === 'merging') expect(two).not.toBe('building')
  }
  expect(moveAt(2, 'building')).toBeGreaterThan(moveAt(1, 'done'))
}, 90_000)

test('88.5 the merge queue merges one ticket at a time while three build', () => {
  project([1, 2, 3])
  script([writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], greenBinder([1, 2, 3]))
  const r = p.werk(['run', 'root'])
  console.log('88.5 run', r.code, r.stderr)
  const states = everyState()
  expect(Math.max(...states.map((s) => s.filter((t) => t.column === 'building').length))).toBe(3)
  for (const s of states) expect(s.filter((t) => t.column === 'merging').length).toBeLessThanOrEqual(1)
  for (const n of [1, 2, 3]) expect(columnOf(n)).toBe('done')
}, 90_000)
