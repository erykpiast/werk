/** Shared setup for the held-out tests of groups 86, 87 and 88 (command-line side). */
import { expect } from 'bun:test'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

export const MAIN_CLI = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export const ticketOf = (number: number, extra: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: `## What to build\n\nThe feature of ticket ${number} works.\n\n## Acceptance criteria\n\n- The feature works.`,
  root: 'root',
  ...extra,
})

export type Ctx = {
  p: Project
  board: string
  git: (...args: string[]) => string
  appendBoard: (...events: NewBoardEvent[]) => void
  events: () => BoardEvent[]
  columnOf: (n: number, upTo?: BoardEvent[]) => string | undefined
  movesOf: (n: number) => string[]
  moveAt: (n: number, to: string) => number
  firstMove: (to: string) => number
  gates: () => string[]
  mainLine: () => string[]
  promptsOf: (role: string) => string[]
}

export function setup(makefile: string, tickets: TicketFields[], files: Record<string, string> = {}): Ctx {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [path, content] of Object.entries({ 'notes.txt': 'notes\n', ...files })) writeFileSync(join(p.dir, path), content)
  p.run(['git', 'add', '-A'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
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
  const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
  const events = () => readLog<BoardEvent>(board)
  return {
    p,
    board,
    git,
    appendBoard,
    events,
    columnOf: (n, upTo = events()) => foldBoard(upTo).columns.find((c) => c.tickets.some((t) => t.number === n))?.name,
    movesOf: (n) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : [])),
    moveAt: (n, to) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to),
    firstMove: (to) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === to),
    gates: () => events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : [])),
    mainLine: () => git('log', '--first-parent', '--format=%s', 'main').split('\n'),
    promptsOf: (role) => {
      const roles = p.agentRoles()
      return p.agentInputs().flatMap((lines, i) => {
        const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
        return roles[i] === role && user ? [user.message.content] : []
      })
    },
  }
}

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
export const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
export const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
export const author = reply({ steps: [{ text: STEP }] })

/** The board column of every ticket after each prefix of the board log. */
export function snapshots(events: BoardEvent[]): Map<number, string>[] {
  const out: Map<number, string>[] = []
  for (let i = 1; i <= events.length; i++) {
    const board = foldBoard(events.slice(0, i))
    out.push(new Map(board.columns.flatMap((c) => c.tickets.map((t) => [t.number, c.name] as const))))
  }
  return out
}

export const readText = (path: string) => readFileSync(path, 'utf8')
export { expect }
