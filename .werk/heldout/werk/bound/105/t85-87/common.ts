/** Shared setup for the held-out tests of tickets 85, 86 and 87. */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

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

export const reply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const resultStep = reply({}).steps[0]!
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, resultStep] })
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})

export type Ctx = {
  p: Project
  werk: string
  board: string
  git: (...args: string[]) => string
  appendBoard: (...events: NewBoardEvent[]) => void
  events: () => BoardEvent[]
  columnOf: (n: number) => string | undefined
  movesOf: (n: number) => string[]
  prompts: (role: string) => string[]
  runRecord: () => any[]
  session: (n: number) => any[]
}

/** A project with a Makefile on main, a decided subtree root -> loop, and the tickets in ready. */
export function project(makefile: string, tickets: TicketFields[], extraFiles: Record<string, string> = {}): Ctx {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [f, c] of Object.entries(extraFiles)) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', '.'])
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
  const events = () => readLog<BoardEvent>(board)
  const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
  return {
    p,
    werk,
    board,
    git,
    appendBoard,
    events,
    columnOf: (n) => foldBoard(events()).columns.find((c) => c.tickets.some((t) => t.number === n))?.name,
    movesOf: (n) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : [])),
    prompts: (role) => {
      const roles = p.agentRoles()
      return p.agentInputs().flatMap((lines, i) => {
        const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
        return roles[i] === role && user ? [user.message.content] : []
      })
    },
    runRecord: () => {
      const runs = join(werk, 'runs')
      return readdirSync(runs)
        .filter((f) => f.endsWith('.jsonl'))
        .flatMap((f) => readFileSync(join(runs, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
    },
    session: (n) => {
      const f = join(werk, 'sessions', `${n}.jsonl`)
      return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    },
  }
}
