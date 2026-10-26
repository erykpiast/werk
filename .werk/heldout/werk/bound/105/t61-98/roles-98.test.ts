import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import type { FakeReply, FakeScript } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.run(['git', 'worktree', 'prune']))

const MAKEFILE = 'check:\n\t@test -f built.txt\n'
const ticket: TicketFields = {
  number: 7,
  title: 'The built file is there',
  cites: ['leaf'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nWrite built.txt.\n\n## Acceptance criteria\n\n- built.txt is there.',
  root: 'root',
}

/** A temporary git repository with a Makefile, a decided card and one ticket in ready. */
function project(): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('leaf', { status: 'decided', parent: 'root' }), accepted('leaf'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(join(werk, 'board.jsonl'), board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n')
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want built.txt.\n')
  return p
}

const done = (text: string, cost = 0.01) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: text } })
const BUILDER_MARK = 'BUILDER-REPLY-ZQX'
const GRADER_MARK = 'GRADER-REPLY-ZQY'
const builderReply: FakeReply = {
  steps: [{ event: { type: 'assistant', message: { content: [{ type: 'text', text: BUILDER_MARK }] } } }, { edit: { path: 'built.txt', content: 'built\n' } }, done(BUILDER_MARK, 0.1)],
  exit: 0,
}
const graderReply: FakeReply = {
  steps: [done(`${GRADER_MARK}\n${JSON.stringify({ lines: ['ac-1', '#leaf'].map((id) => ({ id, score: 4, gap: 'none' })) })}`)],
}
/** Any other launch (the reviewers, the step author) plays the top-level reply: no finding. */
const script = (builder: FakeReply = builderReply): FakeScript => ({
  steps: [done(`Done.\n${JSON.stringify({ findings: [] })}`)],
  roles: { builder, grader: graderReply },
})

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''

function launchesOf(role: string) {
  const roles = p.agentRoles()
  const inputs = p.agentInputs()
  const argv = p.agentLaunches()
  return roles.flatMap((r, i) => (r === role ? [{ argv: argv[i]!, prompt: promptOf(inputs[i]!) + argv[i]!.join(' ') }] : []))
}

test('98.1 a build pass and its grader each get the reply scripted for their role', () => {
  project()
  p.scriptAgent(script())
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  // the prompts hold no word the script refers to
  for (const role of ['builder', 'grader']) for (const l of launchesOf(role)) {
    expect(l.prompt).not.toContain(BUILDER_MARK)
    expect(l.prompt).not.toContain(GRADER_MARK)
  }
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(git('show', `${branch}:built.txt`)).toBe('built')
  expect(git('log', '--format=%s', `main..${branch}`)).toContain('pass 1')
  expect(launchesOf('builder')).toHaveLength(1)
  expect(launchesOf('grader')).toHaveLength(1)
  // the grader's reply was read: the run record holds the pass as graded, with the grader's lines
  expect(r.stdout).toContain('pass 1: green')
  const runs = readFileSync(join(p.dir, '.werk', 'runs', Bun.spawnSync(['ls', join(p.dir, '.werk', 'runs')]).stdout.toString().trim().split('\n')[0]!), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  expect(runs[0].grade).toMatchObject({ pass: true })
  // the builder's own session shows only the builder reply
  const session = readFileSync(join(p.dir, '.werk', 'sessions', '7.jsonl'), 'utf8')
  expect(session).toContain(BUILDER_MARK)
  expect(session).not.toContain(GRADER_MARK)
  expect(runs[0].grade.lines.map((l: { id: string; score: number }) => [l.id, l.score])).toEqual([['ac-1', 4], ['#leaf', 4]])
})

test('98.4 a build pass with a permission ask plays one turn and exits with the script code', () => {
  project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...builderReply.steps], exit: 0 }
  p.scriptAgent(script(asking))
  const started = performance.now()
  const r = p.werk(['build', '7'])
  expect(performance.now() - started).toBeLessThan(60_000)
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  const builders = p.agentRoles().map((role, i) => ({ role, i })).filter((x) => x.role === 'builder')
  expect(builders).toHaveLength(1)
  const input = p.agentInputs()[builders[0]!.i]!
  // werk answered the ask on the builder's input, and sent no second user message (no second turn)
  expect(input.filter((m) => (m as { type?: string }).type === 'control_response')).toHaveLength(1)
  expect(input.filter((m) => (m as { type?: string }).type === 'user')).toHaveLength(1)
  const runs = readFileSync(join(p.dir, '.werk', 'runs', Bun.spawnSync(['ls', join(p.dir, '.werk', 'runs')]).stdout.toString().trim().split('\n')[0]!), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  expect(runs[0]).toMatchObject({ agentExit: 0 })
})

test('98.5 a reworded prompt does not change which reply a role gets', () => {
  // First build: the prompt as werk writes it.
  project()
  p.scriptAgent(script())
  const first = p.werk(['build', '7'])
  expect(first.code).toBe(0)
  const firstBuilderPrompt = launchesOf('builder')[0]!.prompt
  // Second build: same script, a reworded ticket brief changes the builder prompt text.
  project()
  const board = join(p.dir, '.werk', 'board.jsonl')
  writeFileSync(board, readFileSync(board, 'utf8').replace('Write built.txt.', 'Please produce a file named built.txt in the root, reworded.'))
  p.scriptAgent(script())
  const second = p.werk(['build', '7'])
  const secondBuilderPrompt = launchesOf('builder')[0]!.prompt
  expect(secondBuilderPrompt).not.toBe(firstBuilderPrompt)
  expect(second.code).toBe(first.code)
  expect(second.stdout).toContain('pass 1: green')
  const branch = /werk-build\/[\w-]+/.exec(second.stdout)![0]
  expect(git('show', `${branch}:built.txt`)).toBe('built')
  expect(launchesOf('grader')).toHaveLength(1)
})
