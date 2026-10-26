/** Shared setup for the s86 held-out tests (groups 86, 87, 88). */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard, type BoardTicket } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply, FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

export const ticketOf = (number: number, extra: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...extra,
})

export type Ctx = {
  p: Project
  board: string
  store: string
  git: (...args: string[]) => string
  appendBoard: (...events: NewBoardEvent[]) => void
  events: () => BoardEvent[]
  /** The board as it was after each event of the board log, in order. */
  states: () => BoardTicket[][]
  ticket: (n: number, upTo?: BoardEvent[]) => BoardTicket | undefined
  prompts: (role: string) => string[]
}

/** A temp git project with a Makefile, files, a decided subtree "root" and the tickets in ready. */
export function setup(makefile: string, files: Record<string, string>, tickets: TicketFields[]): Ctx {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [path, content] of Object.entries(files)) writeFileSync(join(p.dir, path), content)
  p.run(['git', 'add', '-A'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the project'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board = join(werk, 'board.jsonl')
  writeFileSync(board, '')
  const appendBoard = (...events: NewBoardEvent[]) => {
    for (const e of events) appendFileSync(board, JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
  }
  appendBoard(...tickets.map((t): NewBoardEvent => ({ type: 'ticket.planned', payload: t })))
  const events = () => readLog<BoardEvent>(board)
  const ctx: Ctx = {
    p,
    board,
    store: join(werk, 'heldout', 'root'),
    git: (...args) => p.run(['git', ...args]).stdout.trim(),
    appendBoard,
    events,
    states: () => {
      const all = events()
      return all.map((_, i) => foldBoard(all.slice(0, i + 1)).columns.flatMap((c) => c.tickets))
    },
    ticket: (n, upTo = events()) => foldBoard(upTo).columns.flatMap((c) => c.tickets).find((t) => t.number === n),
    prompts: (role) => {
      const roles = p.agentRoles()
      return p.agentInputs().flatMap((lines, i) => {
        const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
        return roles[i] === role && user ? [user.message.content] : []
      })
    },
  }
  return ctx
}

export const result = (object: unknown): FakeStep => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})
export const reply = (object: unknown, before: FakeStep[] = []): FakeReply => ({ steps: [...before, result(object)] })
/** A builder pass that writes one file. */
export const writes = (path: string, content = `${path}\n`, before: FakeStep[] = []): FakeReply => ({
  steps: [...before, { edit: { path, content } }, result({})],
})
/** A grader that passes every line, and five reviewers with no finding. */
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
export const STEP = (mark: string) => `Given the product is installed\nWhen the user opens the feature\nThen the user sees ${mark}`
/** A binder that binds each step id to a command. */
export const binder = (bindings: Record<string, string>, before: FakeStep[] = []): FakeReply =>
  reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) }, before)
/** A binder that binds every step of the given tickets (one step each) to `true`. */
export const greenBinder = (tickets: number[]) => binder(Object.fromEntries(tickets.map((n) => [`${n}.1`, 'true'])))
