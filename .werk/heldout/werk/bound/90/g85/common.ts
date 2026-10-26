/** Shared setup for the g85 held-out tests: a temporary project with tickets on the board. */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

export function project(makefile: string, tickets: TicketFields[], files: Record<string, string> = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [f, c] of Object.entries(files)) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', '.'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(werk, 'board.jsonl'), '')
  appendBoard(p, ...tickets.map((t): NewBoardEvent => ({ type: 'ticket.planned', payload: t })))
  return p
}

export function appendBoard(p: Project, ...events: NewBoardEvent[]) {
  for (const e of events)
    appendFileSync(join(p.dir, '.werk', 'board.jsonl'), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const result = (cost = 0.1) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, result()] })
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reply({ findings: [] })])),
})

export const boardEvents = (p: Project) => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
export const columnOf = (p: Project, n: number) => foldBoard(boardEvents(p)).columns.find((c) => c.tickets.some((t) => t.number === n))?.name
export const movesOf = (p: Project, n: number) =>
  boardEvents(p).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
export const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const sessionEntries = (p: Project, n: number) => {
  const f = join(p.dir, '.werk', 'sessions', `${n}.jsonl`)
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
}
export const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  return readdirSync(runs)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(join(runs, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content
export const prompts = (p: Project, role: string) => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => {
    const c = roles[i] === role ? promptOf(lines) : undefined
    return c === undefined ? [] : [c]
  })
}
export const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
export const toolResult = (id: string, isError = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'make: *** [check] Error 1' : 'ok', is_error: isError }] } },
})
