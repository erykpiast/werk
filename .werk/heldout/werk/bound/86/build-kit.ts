/** Shared setup for the held-out build steps 84, 85 and 86. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event, NewEvent } from '../src/map/events.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { logOf } from '../src/test/map-events.ts'

export const MAKEFILE = 'check:\n\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }\n'

export function makeBuildProject(ticket: TicketFields, mapEvents: NewEvent[], makefile = MAKEFILE): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', ticket.root ?? 'root'), { recursive: true })
  const log: Event[] = logOf(...mapEvents)
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(werk, 'board.jsonl'), '')
  appendBoard(p, { type: 'ticket.planned', payload: ticket })
  writeFileSync(join(werk, 'plans', ticket.root ?? 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a person, I want the thing.\n')
  return p
}

export function appendBoard(p: Project, ...events: NewBoardEvent[]) {
  for (const e of events)
    appendFileSync(join(p.dir, '.werk', 'board.jsonl'), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}

export const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
export const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
export const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const grading = (ids: string[], score: (id: string) => number, gap: (id: string) => string = () => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const quietReviewers = () => Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()]))

export const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content
export const prompts = (p: Project, role: string) => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => {
    const prompt = promptOf(lines)
    return roles[i] === role && prompt !== undefined ? [prompt] : []
  })
}
export const buildRoles = (p: Project) => p.agentRoles().filter((r) => !r?.startsWith('heldout-') && r !== 'loop-classifier')
export const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
export const boardTicket = (p: Project, n: number) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === n)
export const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0]
