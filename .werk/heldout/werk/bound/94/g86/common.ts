import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- [ ] The feature works.\n- [ ] The user sees it.',
  root: 'root',
  ...extra,
})

export function setup(makefile: string, files: Record<string, string>, tickets: TicketFields[]): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [f, c] of Object.entries(files)) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', '-A'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the project'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(werk, 'board.jsonl'), '')
  appendBoard(p, ...tickets.map((t): NewBoardEvent => ({ type: 'ticket.planned', payload: t })))
  return p
}

export const boardFile = (p: Project) => join(p.dir, '.werk', 'board.jsonl')
export function appendBoard(p: Project, ...events: NewBoardEvent[]) {
  for (const e of events) appendFileSync(boardFile(p), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}
export const events = (p: Project) => readLog<BoardEvent>(boardFile(p))
export const tickets = (p: Project, upTo = events(p)) => foldBoard(upTo).columns.flatMap((c) => c.tickets)
export const columnOf = (p: Project, n: number) => tickets(p).find((t) => t.number === n)?.column
export const movesOf = (p: Project, n: number) =>
  events(p).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
export const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
export const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })

export const prompts = (p: Project, role: string) => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => {
    const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
    return roles[i] === role && user ? [user.message.content] : []
  })
}
export const read = (path: string) => readFileSync(path, 'utf8')
