/** Shared setup for the build group's held-out tests. */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'

export const werkDir = (p: Project) => join(p.dir, '.werk')
export const boardFile = (p: Project) => join(werkDir(p), 'board.jsonl')

export function appendBoard(p: Project, ...events: NewBoardEvent[]) {
  for (const e of events) appendFileSync(boardFile(p), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}

export type Setup = {
  makefile: string
  ticket: TicketFields
  log: Event[]
  /** Extra files to commit on main. */
  files?: Record<string, string>
}

/** A project with a Makefile on main, the map log, and one ticket planned in ready. */
export function makeBuildProject(s: Setup): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), s.makefile)
  for (const [path, content] of Object.entries(s.files ?? {})) writeFileSync(join(p.dir, path), content)
  p.run(['git', 'add', '-A'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(werkDir(p), 'plans', 'root'), { recursive: true })
  writeFileSync(join(werkDir(p), 'log.jsonl'), s.log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(boardFile(p), '')
  appendBoard(p, { type: 'ticket.planned', payload: s.ticket })
  writeFileSync(join(werkDir(p), 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a person, I want the thing.\n')
  return p
}

export const result = (cost: number, text?: string) => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2, ...(text !== undefined && { result: text }) },
})
export const judgeReply = (object: unknown, cost = 0.01): FakeReply => ({ steps: [result(cost, `Done.\n${JSON.stringify(object)}`)] })
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
export const grading = (ids: string[], score: (id: string) => number = () => 4, gap: (id: string) => string = () => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
export const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
export const judges = (ids: string[]): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

export const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
export const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]

export function runRecord(p: Project): any[] {
  const runs = join(werkDir(p), 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}

const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content
/** The first user message of each launch of the role. */
export function prompts(p: Project, role: string): string[] {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => {
    const prompt = promptOf(lines)
    return roles[i] === role && prompt !== undefined ? [prompt] : []
  })
}
/** Every stdin line of each launch of the role, as JSON text. */
export function allInputs(p: Project, role: string): string[] {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? lines.map((l) => JSON.stringify(l)) : []))
}

export function boardTicket(p: Project, number: number) {
  const board = foldBoard(readLog<BoardEvent>(boardFile(p)))
  for (const c of board.columns) for (const t of c.tickets) if (t.number === number) return { column: c.name, retries: t.retries }
  return undefined
}

export function sessionEntries(p: Project, ticket: number): any[] {
  return readFileSync(join(werkDir(p), 'sessions', `${ticket}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}
