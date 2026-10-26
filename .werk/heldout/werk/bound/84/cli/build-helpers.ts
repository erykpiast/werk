/** A build project: a git repository with a Makefile, a map, and one ready ticket on the board. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { NewEvent } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'

export const TICKET = 7

/** The check passes when done.txt is there. Otherwise it prints `fill` characters and fails. */
export const makefile = (fill = 200) =>
  ['check:', `\t@test -f done.txt || { head -c ${fill} /dev/zero | tr "\\\\0" x; echo; echo "done.txt is missing END-MARK"; exit 1; }`, ''].join('\n')

export function buildProject(o: { ticket?: Partial<TicketFields>; map?: NewEvent[]; fill?: number } = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile(o.fill))
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const map = o.map ?? [
    proposed('root', { status: 'decided' }),
    proposed('store', { status: 'decided', parent: 'root', title: 'Store cards in an append-only log', body: 'Never write a card in place.' }),
    accepted('store'),
  ]
  writeFileSync(join(werk, 'log.jsonl'), logOf(...map).map((e) => JSON.stringify(e)).join('\n') + '\n')
  const ticket: TicketFields = {
    number: TICKET,
    title: 'Write the done file',
    cites: ['store'],
    blockedBy: [],
    stories: [1],
    touches: ['builder loop'],
    checks: ['make check'],
    brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds the word done.',
    root: 'root',
    ...o.ticket,
  }
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

export const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
export const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
export const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const grading = (ids: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const judges = (ids: string[]): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids, () => 4),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

export const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0]
export const boardTicket = (p: Project) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === TICKET)
export const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
/** The prompts of the launches of one role, in launch order. A judge gets its prompt on stdin too. */
export const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
export const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)
