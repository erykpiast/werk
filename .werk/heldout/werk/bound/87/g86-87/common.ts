/** Shared setup for the held-out steps 86.x and 87.x. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

export const ticketOf = (number: number, extra: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- [ ] The feature works.',
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
  tickets: () => ReturnType<typeof foldBoard>['columns'][number]['tickets']
  columnOf: (n: number) => string | undefined
  movesOf: (n: number) => string[]
  prompts: (role: string) => string[]
}

/** A project with a Makefile, files, a decided subtree root/loop, and the tickets in ready. */
export function project(makefile: string, files: Record<string, string>, tickets: TicketFields[]): Ctx {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [f, c] of Object.entries(files)) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', '.'])
  p.run(['git', 'commit', '--quiet', '-m', 'The product'])
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
  const tix = () => foldBoard(events()).columns.flatMap((c) => c.tickets)
  return {
    p,
    board,
    store: join(werk, 'heldout', 'root'),
    git: (...args) => p.run(['git', ...args]).stdout.trim(),
    appendBoard,
    events,
    tickets: tix,
    columnOf: (n) => tix().find((t) => t.number === n)?.column,
    movesOf: (n) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : [])),
    prompts: (role) => {
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
export const authorOf = (...texts: string[]) => reply({ steps: texts.map((text) => ({ text })) })
export const binderOf = (bindings: Record<string, string>, files: Record<string, string> = {}): FakeReply => ({
  steps: [
    ...Object.entries(files).map(([path, content]) => ({ edit: { path, content } })),
    ...reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) }).steps,
  ],
})
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', 'ac-3', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
