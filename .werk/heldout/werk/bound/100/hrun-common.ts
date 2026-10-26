/** Shared setup for the held-out tests of groups 87 and 88: a project with a subtree, tickets and a fake agent. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

/** Green everywhere, except on a detached tree (the merge tree) while red.txt holds "red". */
export const MAKEFILE = [
  'check:',
  '\t@if grep -qs red red.txt && ! git symbolic-ref -q HEAD >/dev/null; then echo "MERGE-RED-MARK"; exit 1; fi',
  '',
].join('\n')

export const ticketOf = (number: number, fields: Partial<TicketFields> = {}): TicketFields => ({
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

export type Ctx = ReturnType<typeof setup>

export function setup(tickets: number[], fields: Record<number, Partial<TicketFields>> = {}) {
  const p: Project = makeProject()
  const werk = join(p.dir, '.werk')
  const board = join(werk, 'board.jsonl')
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  writeFileSync(join(p.dir, 'notes.txt'), 'notes\n')
  p.run(['git', 'add', 'Makefile', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board, '')
  const appendBoard = (...events: NewBoardEvent[]) => {
    for (const e of events) appendFileSync(board, JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
  }
  appendBoard(...tickets.map((n): NewBoardEvent => ({ type: 'ticket.planned', payload: ticketOf(n, fields[n]) })))
  const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
  const events = () => readLog<BoardEvent>(board)
  const columnsAt = (upTo: BoardEvent[]) =>
    new Map(foldBoard(upTo).columns.flatMap((c) => c.tickets.map((t) => [t.number, c.name] as const)))
  /** The column of every ticket after each event of the board log, in order. */
  const history = () => {
    const all = events()
    return all.map((_, i) => columnsAt(all.slice(0, i + 1)))
  }
  const movesOf = (n: number) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
  const moveAt = (n: number, to: string) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)
  const gates = () => events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
  const mainLine = () => git('log', '--first-parent', '--format=%s', 'main').split('\n')
  const script = (builder: FakeReply[], binders: FakeReply[]) =>
    p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': author, 'heldout-binder': binders } })
  const launchesOf = (role: string) => p.agentRoles().filter((r) => r === role).length
  return { p, werk, board, appendBoard, git, events, columnsAt, history, movesOf, moveAt, gates, mainLine, script, launchesOf }
}

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
export const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
export const author = reply({ steps: [{ text: STEP }] })
export const binder = (bindings: Record<string, 'true' | 'false'>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
export const greenBinder = (tickets: number[]) => [binder(Object.fromEntries(tickets.map((n) => [`${n}.1`, 'true' as const])))]
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop', '#root'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
