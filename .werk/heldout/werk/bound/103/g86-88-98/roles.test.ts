/** Held-out steps 98.1, 98.2, 98.4 and 98.5: each agent gets the reply scripted for its role. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeScript } from '../../src/test/fake-agent.ts'
import { makeAppCopy, makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { binder, judges, project, reply, REVIEW_AREAS, type Ctx } from './common.ts'

const builderReply: FakeReply = {
  steps: [{ edit: { path: 'built.txt', content: 'built by the builder\n' } }, { event: { type: 'result', subtype: 'success', total_cost_usd: 0.1, num_turns: 1 } }],
}
const gradeReply = reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'GRADER-ONLY-GAP' })) })
const reviewers = Object.fromEntries(REVIEW_AREAS.map((a) => [`reviewer-${a}`, reply({ findings: [] })]))
const roleScript = (): FakeScript => ({ steps: [], roles: { builder: builderReply, grader: gradeReply, ...reviewers } })

const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]

function buildProject(): Ctx {
  return project([3], { makefile: 'check:\n\t@test -f built.txt\n' })
}

test('98.1 a build pass and its grader each get the reply scripted for their role', () => {
  const ctx = buildProject()
  ctx.p.scriptAgent(roleScript())
  const r = ctx.p.werk(['build', '3'])
  expect(r.code).toBe(0)
  // The script picks replies by role only: no prompt holds the words of the other role's reply.
  for (const prompt of ctx.prompts('builder')) {
    expect(prompt).not.toContain('built by the builder')
    expect(prompt).not.toContain('GRADER-ONLY-GAP')
  }
  for (const prompt of ctx.prompts('grader')) expect(prompt).not.toContain('GRADER-ONLY-GAP')
  const roles = ctx.p.agentRoles().filter((x) => !x?.startsWith('heldout-'))
  expect(roles.filter((x) => x === 'builder')).toHaveLength(1)
  expect(roles.filter((x) => x === 'grader')).toHaveLength(1)
  // The builder played the builder reply: its edit is in the pass commit.
  const branch = branchOf(r.stdout)
  expect(ctx.git('show', `${branch}:built.txt`)).toBe('built by the builder')
  expect(ctx.git('log', '-1', '--format=%s', branch)).toBe('werk build 3: pass 1')
  // The grader played the grader reply: the pass is graded and green.
  expect(r.stdout).toContain('pass 1: green')
  // The builder never played the grader reply (no edit), the grader never the builder reply.
  expect(ctx.git('ls-tree', '--name-only', branch).split('\n').toSorted()).toEqual(['Makefile', 'built.txt', 'notes.txt'])
}, 60_000)

test('98.4 a build pass with a permission ask plays one turn and exits with the script code', () => {
  const ctx = buildProject()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...builderReply.steps], exit: 0 }
  ctx.p.scriptAgent({ ...roleScript(), roles: { ...roleScript().roles, builder: asking } })
  const started = Date.now()
  const r = ctx.p.werk(['build', '3'])
  expect(Date.now() - started).toBeLessThan(30_000)
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: the overseer answered a permission ask for Bash')
  const roles = ctx.p.agentRoles()
  const i = roles.indexOf('builder')
  expect(roles.filter((x) => x === 'builder')).toHaveLength(1)
  const inputs = ctx.p.agentInputs()[i]!
  expect(inputs.filter((m) => (m as { type?: string }).type === 'user')).toHaveLength(1)
  expect(inputs.some((m) => (m as { type?: string; response?: { request_id?: string } }).type === 'control_response')).toBe(true)
  expect(ctx.git('show', `${branchOf(r.stdout)}:built.txt`)).toBe('built by the builder')
  const runs = join(ctx.werk(), 'runs')
  const record = readFileSync(join(runs, require('node:fs').readdirSync(runs).find((f: string) => f.endsWith('.jsonl'))), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(record[0].agentExit).toBe(0)
}, 60_000)

test('98.5 a reworded prompt does not change which reply a role gets', () => {
  const ctx = buildProject()
  ctx.p.scriptAgent(roleScript())
  const before = ctx.p.werk(['build', '3'])
  expect(before.code).toBe(0)
  const beforePass = before.stdout.split('\n').filter((l) => l.startsWith('pass '))

  // The same build again, from a copy of werk whose builder prompt has new wording.
  const app = makeAppCopy()
  const brief = join(app.root, 'src', 'build', 'brief.ts')
  const text = readFileSync(brief, 'utf8')
  const reworded = text.replace('in a werk builder loop for ticket', 'in a REWORDED werk builder cycle for ticket')
  expect(reworded).not.toBe(text)
  writeFileSync(brief, reworded)
  const again = buildProject()
  again.p.scriptAgent(roleScript())
  const r = again.p.run([process.execPath, app.main, 'build', '3'])
  expect(again.prompts('builder')[0]).toContain('REWORDED')
  expect(r.code).toBe(before.code)
  expect(r.stdout.split('\n').filter((l) => l.startsWith('pass '))).toEqual(beforePass)
  expect(again.git('show', `${branchOf(r.stdout)}:built.txt`)).toBe('built by the builder')
}, 90_000)

test('98.2 every agent of a full build and plan shows its role in the launch record', () => {
  const p: Project = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'test:\n\t@true\ne2e:\n\t@true\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the checks'])
  mkdirSync(join(p.dir, '.werk'))
  const log = logOf(proposed('map', { status: 'decided', who: 'you' }), proposed('map-reopen', { status: 'decided', parent: 'map' }), accepted('map-reopen'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const PLAN = '.werk/plans/map'
  const spec = '# Spec\n\n## User Stories\n\n1. As a person, I want to reopen a decided card, so that I can change my mind.\n'
  const ticket = [
    'title: A person can reopen a decided card',
    'cites: map-reopen, map',
    'blocked_by:',
    'stories: 1',
    'touches: map view',
    '',
    '## What to build',
    '',
    'A person reopens a decided card.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] A reopened card shows as open.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
  const edit = (path: string, content: string) => ({ edit: { path, content } })
  const STEP = 'Given the product is installed\nWhen the user reopens a card\nThen the user sees it open'
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec), edit(`${PLAN}/spec.answers.json`, '[]')] },
      'ticket-writer': { steps: [edit(`${PLAN}/tickets/01-reopen.md`, ticket), edit(`${PLAN}/tickets.answers.json`, '[]')] },
      builder: { steps: [{ event: { type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] } } }, { sleep: 1500 }, edit('reopen.txt', 'reopened\n'), { event: { type: 'result', subtype: 'success', total_cost_usd: 0.1, num_turns: 1 } }] },
      grader: reply({ lines: ['ac-1', '#map-reopen', '#map'].map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...reviewers,
      'loop-classifier': { steps: [{ event: { type: 'result', subtype: 'success', result: 'progressing' } }] },
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': binder({ '1.1': 'true' }),
    },
  })
  const plan = p.werk(['plan', 'map'])
  expect(plan.code).toBe(0)
  const run = p.werk(['run', 'map', '--loop-every', '200'])
  expect(run.stderr + run.stdout).toContain('G2 is open')
  expect(run.code).toBe(0)
  const launches = readFileSync(p.env.WERK_FAKE_AGENT_LOG!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; role?: string })
  const roles = launches.map((l) => l.role)
  expect(roles.filter((r) => r === 'spec-writer')).toHaveLength(1)
  expect(roles.filter((r) => r === 'ticket-writer')).toHaveLength(1)
  expect(roles.filter((r) => r === 'builder').length).toBeGreaterThanOrEqual(1)
  expect(roles.filter((r) => r === 'grader').length).toBe(roles.filter((r) => r === 'builder').length)
  expect(roles.filter((r) => r?.startsWith('reviewer'))).toHaveLength(5)
  expect(roles).toContain('loop-classifier')
  expect(roles).toContain('heldout-author')
  expect(roles).toContain('heldout-binder')
  for (const l of launches) {
    expect(typeof l.role).toBe('string')
    expect(Array.isArray(l.argv)).toBe(true)
  }
}, 120_000)
