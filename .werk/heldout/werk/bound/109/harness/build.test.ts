/** Held-out steps 98.1, 98.4, 98.5: build passes whose agents get their replies by role. */
import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import type { FakeReply, FakeScript } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'
import { freshClone } from './clone.ts'

const MAKEFILE = 'check:\n\t@test -f feature.txt || { echo "feature.txt is missing"; exit 1; }\n'

const ticket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [2],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nThe thing exists.\n\n## Acceptance criteria\n\n- The thing exists.',
  root: 'root',
}

/** A project with a decided ticket in ready, its cards in the map, and a check on the main line. */
function project(): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', body: 'The loop body.' }),
    proposed('checks', { status: 'decided', title: 'A check is one command' }),
    accepted('loop'),
    accepted('checks'),
    linked('loop', 'checks', 'depends_on'),
  )
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. One.\n2. As a person, I want the thing.\n')
  return p
}

const BUILDER_MARK = 'ZEBRAQUILT'
const GRADER_MARK = 'OCTOPUSLANTERN'
const result = (extra: object = {}) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, ...extra } })
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const builderReply: FakeReply = { steps: [said(`${BUILDER_MARK} writes the file`), { edit: { path: 'feature.txt', content: 'done\n' } }, result()], exit: 0 }
const judge = (object: unknown): FakeReply => ({ steps: [result({ result: `Done.\n${JSON.stringify(object)}` })] })
const LINES = ['ac-1', '#loop', '#checks']
const graderReply = judge({ lines: LINES.map((id) => ({ id, score: 4, gap: `${GRADER_MARK} none` })) })
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const reviewers = Object.fromEntries(REVIEWERS.map((r) => [r, judge({ findings: [] })]))
const script = (builder: FakeReply = builderReply): FakeScript => ({ steps: [], roles: { builder, grader: graderReply, ...reviewers } })

const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  JSON.stringify((lines.find((l) => (l as { type?: string }).type === 'user') as { message: unknown } | undefined)?.message ?? '')
const promptsOf = (p: Project, role: string) => {
  const roles = p.agentRoles()
  const argv = p.agentLaunches()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines) + JSON.stringify(argv[i])] : []))
}
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0]
const session = (p: Project) => readFileSync(join(p.dir, '.werk', 'sessions', '3.jsonl'), 'utf8')

/** Checks the outcome that 98.1 and 98.5 share: each role played its own reply. */
function expectRolesPlayedTheirReplies(p: Project, r: { code: number; stdout: string }) {
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  expect(branch).toBeDefined()
  expect(p.run(['git', 'show', `${branch}:feature.txt`]).stdout).toBe('done\n')
  expect(r.stdout).toContain('pass 1: green')
  const [line] = runRecord(p)
  expect(line.grade.pass).toBe(true)
  expect(JSON.stringify(line.grade)).toContain(GRADER_MARK)
  expect(JSON.stringify(line.grade)).not.toContain(BUILDER_MARK)
  // The builder's own session holds the builder reply and none of the grader reply.
  expect(session(p)).toContain(BUILDER_MARK)
  expect(session(p)).not.toContain(GRADER_MARK)
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
  expect(p.agentRoles().filter((x) => x === 'grader')).toHaveLength(1)
}

test('98.1 a build pass and its grader each get the reply scripted for their role', () => {
  const p = project()
  p.run(['git', 'worktree', 'prune'])
  p.scriptAgent(script())
  const r = p.werk(['build', '3'])
  if (r.code !== 0) console.log(r.stdout, r.stderr)
  for (const prompt of [...promptsOf(p, 'builder'), ...promptsOf(p, 'grader')]) {
    expect(prompt).not.toContain(BUILDER_MARK)
    expect(prompt).not.toContain(GRADER_MARK)
  }
  expect(promptsOf(p, 'builder')).toHaveLength(1)
  expect(promptsOf(p, 'grader')).toHaveLength(1)
  expectRolesPlayedTheirReplies(p, r)
}, 60_000)

test('98.4 a build pass with a permission ask plays one turn and exits with the script code', () => {
  const p = project()
  const asking: FakeReply = {
    steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, said('after the ask'), { edit: { path: 'feature.txt', content: 'done\n' } }, result()],
    exit: 0,
  }
  p.scriptAgent(script(asking))
  const started = performance.now()
  const r = p.werk(['build', '3'])
  expect(performance.now() - started).toBeLessThan(50_000)
  if (r.code !== 0) console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  const builder = p.agentRoles().indexOf('builder')
  // werk answered the ask on the builder input.
  expect(p.agentInputs()[builder]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  const events = session(p)
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { event?: { type?: string } })
    .flatMap((e) => (e.event ? [e.event] : []))
  // The same reply finishes after the answer: its tool result, its text, and one final result. No second turn.
  const types = events.map((e) => e.type)
  expect(types.filter((t) => t === 'result')).toHaveLength(1)
  expect(types.indexOf('control_request')).toBeLessThan(types.indexOf('result'))
  expect(JSON.stringify(events)).toContain('after the ask')
  const [line] = runRecord(p)
  expect(line.agentExit).toBe(0)
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
}, 60_000)

test('98.5 a reworded prompt does not change which reply a role gets', () => {
  // The build as it is.
  const a = project()
  a.scriptAgent(script())
  const ra = a.werk(['build', '3'])
  expectRolesPlayedTheirReplies(a, ra)

  // The same build with a reworded builder prompt, in a copy of werk outside the repo.
  const { dir } = freshClone()
  symlinkSync(join(import.meta.dir, '..', '..', 'node_modules'), join(dir, 'node_modules'))
  const briefPath = join(dir, 'src', 'build', 'brief.ts')
  const before = readFileSync(briefPath, 'utf8')
  const after = before
    .replace('in a werk builder loop for ticket', 'inside the werk build cycle working on ticket')
    .replace('Do one unit of work toward the ticket, then exit.', 'Make a single step of progress on the ticket, and then stop.')
  expect(after).not.toBe(before)
  writeFileSync(briefPath, after)
  const b = project()
  b.scriptAgent(script())
  const rb = b.run([process.execPath, join(dir, 'src', 'cli', 'main.ts'), 'build', '3'])
  expect(promptsOf(b, 'builder')[0]).toContain('Make a single step of progress on the ticket')
  expectRolesPlayedTheirReplies(b, rb)
  const outcome = (s: string) => s.split('\n').filter((l) => /^pass \d+:/.test(l) || /green|red/.test(l)).map((l) => l.replace(/werk-build\/[\w-]+/g, 'B').replace(/[0-9a-f]{7,40}/g, 'H'))
  expect(rb.code).toBe(ra.code)
  expect(outcome(rb.stdout)).toEqual(outcome(ra.stdout))
  expect(outcome(ra.stdout).length).toBeGreaterThan(0)
}, 120_000)
