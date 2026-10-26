/** Shared setup for the s83/s84/s85 held-out tests: a project with one ready ticket on the board. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, linked, logOf, proposed, statusSet } from '../src/test/map-events.ts'
import type { NewEvent } from '../src/map/events.ts'

export const DEFAULT_MAKEFILE = [
  'check:',
  '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" x; echo; echo "done.txt is missing END-MARK"; exit 1; }',
  '',
].join('\n')

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

export type Setup = { ticket?: Partial<TicketFields>; map?: NewEvent[]; makefile?: string }

export function setupProject(s: Setup = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), s.makefile ?? DEFAULT_MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const map = s.map ?? [
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', body: 'The loop body.' }),
    accepted('loop'),
  ]
  const log = logOf(...map)
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...s.ticket } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

export { accepted, linked, proposed, statusSet }

export const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
export const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
export const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const grading = (lines: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: lines.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const judges = (lines: string[]): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(lines, () => 4),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

export const isHeldout = (role: string | undefined) => role?.startsWith('heldout-') === true
export const buildRoles = (p: Project) => p.agentRoles().filter((r) => !isHeldout(r)).map((r) => r ?? '')
/** Roles with each run of reviewer launches sorted, since they start at the same time. */
export const launchedRoles = (p: Project) => {
  const roles = buildRoles(p)
  const out: string[] = []
  for (let i = 0; i < roles.length; ) {
    if (!roles[i]!.startsWith('reviewer-')) out.push(roles[i++]!)
    else {
      const group: string[] = []
      while (i < roles.length && roles[i]!.startsWith('reviewer-')) group.push(roles[i++]!)
      out.push(...group.toSorted((a, b) => REVIEWERS.indexOf(a) - REVIEWERS.indexOf(b)))
    }
  }
  return out
}

export const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0] ?? ''
export const boardTicket = (p: Project, n = 3) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === n)
export const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
export const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
export const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)
