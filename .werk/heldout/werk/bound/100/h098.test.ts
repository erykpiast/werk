/** Held-out steps 98.1, 98.2, 98.4, 98.5: each agent role gets its own scripted reply. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewBoardEvent, TicketFields } from '../src/board/events.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const MAKEFILE = 'check:\n\t@test -f built.txt\n'
const ticket: TicketFields = {
  number: 3,
  title: 'The thing is built',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake built.txt.\n\n## Acceptance criteria\n\n- built.txt is there.',
  root: 'root',
}

/** A temporary project with a decided ticket in ready, a decided card it cites, and a temporary git repository. */
function project(): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want built.txt.\n')
  return p
}

const resultWith = (text: string, cost = 0.01) => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1, result: text },
})
const judge = (object: unknown): FakeReply => ({ steps: [resultWith(`Done.\n${JSON.stringify(object)}`)] })
const AREAS = ['design', 'maintainability', 'tests', 'security', 'performance']
const reviewers = () => Object.fromEntries(AREAS.map((a) => [`reviewer-${a}`, judge({ findings: [] })]))
const builderReply: FakeReply = { steps: [{ edit: { path: 'built.txt', content: 'BUILDER-REPLY\n' } }, resultWith('BUILDER-DONE', 0.2)], exit: 0 }
const graderReply = judge({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) })

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''

test('98.1 a build pass and its grader each get the reply scripted for their role', () => {
  // Given a temporary project with a decided ticket and a temporary git repository
  // And the fake agent is first on the PATH
  // And the script holds one reply for the builder role that edits a file and exits with code 0
  // And the script holds one reply for the grader role that gives a passing grade
  // And the builder prompt and the grader prompt contain no words the script refers to
  // When the test writer runs a build of the ticket
  // Then the builder launch plays the builder reply and the edited file is in the pass commit
  // And the grader launch plays the grader reply and the build reports the pass as graded
  // And the builder launch never plays the grader reply, and the grader launch never plays the builder reply
  project()
  expect(p.env.PATH!.split(':')[0]).toBe(join(p.dir, '..', 'bin'))
  p.scriptAgent({ steps: [], roles: { builder: builderReply, grader: graderReply, ...reviewers() } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const roles = p.agentRoles()
  const inputs = p.agentInputs()
  const builderIdx = roles.indexOf('builder')
  const graderIdx = roles.indexOf('grader')
  expect(builderIdx).toBeGreaterThanOrEqual(0)
  expect(graderIdx).toBeGreaterThanOrEqual(0)
  // The prompts hold no word the script refers to.
  for (const i of [builderIdx, graderIdx]) {
    const prompt = promptOf(inputs[i]!)
    for (const word of ['BUILDER-DONE', 'progressing', 'heldout']) expect(prompt).not.toContain(word)
  }
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:built.txt`)).toBe('BUILDER-REPLY')
  expect(r.stdout).toContain('pass 1: green')
  const [line] = runRecord()
  expect(line.grade).toMatchObject({ pass: true })
  expect(line.grade.lines.map((l: { id: string; score: number }) => [l.id, l.score])).toEqual([
    ['ac-1', 4],
    ['#loop', 4],
  ])
  // The builder's own cost is the builder reply's cost; the grader's is the judge cost.
  expect(line.costUsd).toBe(0.2)
}, 180_000)

test('98.2 every agent of a full build and plan shows its role in the launch record', () => {
  // Given a temporary project and a temporary git repository with the fake agent first on the PATH
  // And the script holds a reply for the spec writer, ticket writer, builder, grader, reviewer, classifier, step author and binder roles
  // When the test writer runs the spec step and the ticket step of the plan
  // And the test writer runs a build of one ticket through its loop to a merge
  // Then the launch record shows one launch with role spec writer and one with role ticket writer
  // And the launch record shows each build pass with role builder and its grader with role grader
  // And the launch record shows five launches with role reviewer
  // And the launch record shows the loop classifier with role classifier, the step author with role step author and the binder with role binder
  // And each launch record entry shows the role next to the arguments of that launch
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(p.dir, '.werk'))
  const log = logOf(proposed('map', { status: 'decided', who: 'you' }), proposed('map-built', { status: 'decided', parent: 'map' }), accepted('map-built'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const PLAN = '.werk/plans/map'
  const spec = '# Spec: build it\n\n## Problem Statement\n\nNothing is built.\n\n## User Stories\n\n1. As a person, I want the thing built, so that I use it.\n'
  const ticketText = [
    'title: The thing is built',
    'cites: map-built, #map',
    'blocked_by:',
    'stories: 1',
    'touches: builder loop',
    '',
    '## What to build',
    '',
    'The thing is built.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The thing is built.',
    '',
    '## Checks',
    '',
    '- `make check`',
    '',
  ].join('\n')
  const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees it'
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [{ edit: { path: `${PLAN}/spec.md`, content: spec } }, { edit: { path: `${PLAN}/spec.answers.json`, content: '[]' } }] },
      'ticket-writer': {
        steps: [{ edit: { path: `${PLAN}/tickets/01-built.md`, content: ticketText } }, { edit: { path: `${PLAN}/tickets.answers.json`, content: '[]' } }],
      },
      // The builder works long enough for the loop check to run once.
      builder: { steps: [{ edit: { path: 'built.txt', content: 'built\n' } }, { event: { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } } }, { sleep: 600 }, resultWith('done', 0.2)] },
      grader: judge({ lines: ['ac-1', '#map-built', '#map'].map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...reviewers(),
      'loop-classifier': { steps: [resultWith('progressing')] },
      'heldout-author': judge({ steps: [{ text: STEP }] }),
      'heldout-binder': judge({ steps: [{ id: '1.1', cmd: 'true' }] }),
    },
  })
  const plan = p.werk(['plan', 'map'])
  expect(plan.stderr).toBe('')
  expect(plan.code).toBe(0)
  const run = p.werk(['run', 'map', '--parallel', '1', '--loop-every', '100'])
  expect(run.code).toBe(0)
  expect(git('log', '--first-parent', '--format=%s', 'main')).toContain('merge ticket 1')

  const roles = p.agentRoles()
  const count = (role: string) => roles.filter((r) => r === role).length
  expect(count('spec-writer')).toBe(1)
  expect(count('ticket-writer')).toBe(1)
  expect(count('builder')).toBe(1)
  expect(count('grader')).toBe(1)
  expect(roles.filter((r) => r?.startsWith('reviewer')).length).toBe(5)
  expect(count('loop-classifier')).toBeGreaterThanOrEqual(1)
  expect(count('heldout-author')).toBeGreaterThanOrEqual(1)
  expect(count('heldout-binder')).toBeGreaterThanOrEqual(1)
  // Each entry of the launch record holds the role next to the argv of that launch.
  const entries = readFileSync(p.env.WERK_FAKE_AGENT_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const e of entries) {
    expect(typeof e.role).toBe('string')
    expect(Array.isArray(e.argv)).toBe(true)
  }
}, 180_000)

test('98.4 a build pass with a permission ask plays one turn and exits with the script code', () => {
  // Given a temporary project with a decided ticket and a temporary git repository with the fake agent first on the PATH
  // And the script holds one builder reply that prints a permission ask, then finishes, with exit code 0
  // When the test writer runs a build of the ticket
  // And werk answers the permission ask on the builder input
  // Then the builder finishes the same reply after the answer and does not start a second turn
  // And the builder exits with code 0 and the build does not hang
  // And the launch record shows one builder launch for that pass
  project()
  const asking: FakeReply = {
    steps: [{ ask: { id: 'r1', tool: 'Bash', input: { command: 'touch built.txt' } } }, { edit: { path: 'built.txt', content: 'x\n' } }, resultWith('done', 0.1)],
    exit: 0,
  }
  p.scriptAgent({ steps: [], roles: { builder: asking, grader: graderReply, ...reviewers() } })
  const started = performance.now()
  const r = p.werk(['build', '3'])
  expect(performance.now() - started).toBeLessThan(60_000)
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: the overseer answered a permission ask for Bash')
  const roles = p.agentRoles()
  expect(roles.filter((x) => x === 'builder')).toHaveLength(1)
  const builderInput = p.agentInputs()[roles.indexOf('builder')]!
  // One user message (one turn) and one answer to the ask.
  expect(builderInput.filter((l) => (l as { type?: string }).type === 'user')).toHaveLength(1)
  expect(builderInput.filter((l) => (l as { type?: string }).type === 'control_response')).toHaveLength(1)
  const [line] = runRecord()
  expect(line.agentExit).toBe(0)
}, 180_000)

test('98.5 a reworded prompt does not change which reply a role gets', () => {
  // Given a build that passes with one builder reply and one grader reply scripted by role
  // When the builder prompt text changes to new wording
  // And the test writer runs the same build again with the same script
  // Then the builder launch still plays the builder reply and the grader launch still plays the grader reply
  // And the build ends with the same result as before
  // The builder prompt is made from the ticket brief, so the new wording is a new brief.
  const runOnce = (brief: string) => {
    project()
    const board = join(p.dir, '.werk', 'board.jsonl')
    const e = { type: 'ticket.planned', payload: { ...ticket, brief }, seq: 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }
    writeFileSync(board, JSON.stringify(e) + '\n')
    p.scriptAgent({ steps: [], roles: { builder: builderReply, grader: graderReply, ...reviewers() } })
    const r = p.werk(['build', '3'])
    const roles = p.agentRoles()
    const prompt = promptOf(p.agentInputs()[roles.indexOf('builder')]!)
    const out = { code: r.code, green: r.stdout.includes('pass 1: green'), file: git('show', `${branchOf(r.stdout)}:built.txt`), grade: runRecord()[0].grade?.pass, prompt }
    return out
  }
  const before = runOnce(ticket.brief)
  const after = runOnce('## What to build\n\nProduce the file named built dot txt in the root.\n\n## Acceptance criteria\n\n- The file built dot txt exists.')
  expect(before.prompt).not.toBe(after.prompt)
  expect(after.file).toBe('BUILDER-REPLY')
  expect(after.grade).toBe(true)
  expect({ code: after.code, green: after.green }).toEqual({ code: before.code, green: before.green })
  expect(after.code).toBe(0)
}, 180_000)
