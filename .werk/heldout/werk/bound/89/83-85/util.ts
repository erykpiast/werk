/** Shared set-up for the 83-85 held-out tests. It copies the patterns of src/cli/build.test.ts. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { NewEvent } from '../../src/map/events.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'

/** The check passes when done.txt is there; else it prints a short line and fails. */
export const MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing END-MARK"; exit 1; }', ''].join('\n')

export const baseTicket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [2],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}

export const defaultMap = (): NewEvent[] => [
  proposed('root', { status: 'decided' }),
  proposed('loop', { status: 'decided', parent: 'root', body: 'The loop body.' }),
  accepted('loop'),
]

export type Setup = { fields?: Partial<TicketFields>; makefile?: string; map?: NewEvent[] }

export function project(s: Setup = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), s.makefile ?? MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(...(s.map ?? defaultMap()))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...s.fields } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. One.\n2. As a builder, I want done.txt.\n')
  return p
}

export { accepted, linked, proposed }

export const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
export const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
export const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const grading = (ids: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const judges = (ids: string[] = ['ac-1', '#loop']): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids, () => 4),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

export const gitOf = (p: Project) => (...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const boardTicket = (p: Project, n = 3) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === n)
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0] ?? ''
export const runRecord = (p: Project): any[] => {
  const runs = join(p.dir, '.werk', 'runs')
  if (!existsSync(runs)) return []
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))
  if (!file) return []
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
export const sessionLog = (p: Project, n = 3): any[] => {
  const f = join(p.dir, '.werk', 'sessions', `${n}.jsonl`)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
export const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
export const buildRoles = (p: Project) => p.agentRoles().filter((r) => !r?.startsWith('heldout-')).map((r) => r ?? '')
export const lastFailure = (prompt: string) =>
  prompt.includes('## Last failure\n\n') ? prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length) : ''

export const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
export const toolResult = (id: string, isError = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'make: *** [check] Error 1' : 'ok', is_error: isError } ] } },
})
