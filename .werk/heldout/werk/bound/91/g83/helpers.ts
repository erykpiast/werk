import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event, NewEvent } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'

export const baseTicket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}

/** The check passes when done.txt is there. */
export const DONE_MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')

export function project(opts: { makefile?: string; ticket?: Partial<TicketFields>; map?: NewEvent[] } = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), opts.makefile ?? DONE_MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const map = opts.map ?? [
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', body: 'The loop body.' }),
    accepted('loop'),
  ]
  const log = logOf(...map)
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...opts.ticket } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

export { accepted, linked, proposed }

export const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
export const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
export const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const grading = (lines: string[], score: (id: string) => number = () => 4, gap: (id: string) => string = () => 'none') =>
  judgeReply({ lines: lines.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const AREAS = ['design', 'maintainability', 'tests', 'security', 'performance']
export const REVIEWERS = AREAS.map((a) => `reviewer-${a}`)
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const judges = (lines: string[]): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(lines),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

export const gitOf = (p: Project) => (...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0]
export const boardOf = (p: Project) => foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
export const boardTicket = (p: Project, n = 3) =>
  boardOf(p)
    .columns.flatMap((c) => c.tickets.map((t) => ({ ...t, column: c.name })))
    .find((t) => t.number === n)
export const runRecord = (p: Project): any[] => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
export const mapLog = (p: Project): Event[] => readLog(join(p.dir, '.werk', 'log.jsonl'))
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
export const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
export const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
export const toolResult = (id: string, content = 'ok') => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } },
})
