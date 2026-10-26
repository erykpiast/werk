/** Shared setup for held-out steps 83, 84, 85: a project with a ready ticket and a check. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import type { NewEvent } from '../src/map/events.ts'
import { accepted, linked, logOf, proposed } from '../src/test/map-events.ts'

/** The check is green when done.txt is in the tree, and red with `noise` characters of output otherwise. */
export const makefile = (noise = 500) =>
  [
    'check:',
    `\t@test -f done.txt || { head -c ${noise} /dev/zero | tr "\\\\0" x; echo; echo "done.txt is missing TAIL-MARK"; exit 1; }`,
    '',
  ].join('\n')

export const baseTicket: TicketFields = {
  number: 7,
  title: 'Make the done file',
  cites: ['core'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nWrite done.txt.\n\n## Acceptance criteria\n\n- done.txt is in the tree.',
  root: 'root',
}

export type Setup = {
  ticket?: Partial<TicketFields>
  noise?: number
  map?: NewEvent[]
}

export const defaultMap = (): NewEvent[] => [
  proposed('root', { status: 'decided' }),
  proposed('core', { status: 'decided', parent: 'root', title: 'The core card', body: 'The core body.' }),
  accepted('core'),
]

export function project(s: Setup = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile(s.noise))
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(...(s.map ?? defaultMap()))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...s.ticket } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

export const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1 } })
export const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
export const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const grading = (ids: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const judges = (ids = ['ac-1', '#core']): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids, () => 4),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

export const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
export const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
export const boardTicket = (p: Project, n = 7) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === n)
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
export const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
export const buildRoles = (p: Project) => p.agentRoles().filter((r) => !r?.startsWith('heldout-'))
export const lastFailure = (prompt: string) => {
  const i = prompt.indexOf('## Last failure\n\n')
  return i === -1 ? '' : prompt.slice(i + '## Last failure\n\n'.length)
}
