/** 98.1, 98.2, 98.4, 98.5: each agent gets the reply scripted for its role. Run from the repo root, with the unit test preload. */
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProject } from '../../src/test/harness.ts'
import { BUILDER, GRADER, runBuild, setUp } from './build-scenario.ts'
import { freshClone, sh } from './repo/clone.ts'

const LONG = 120_000

test('98.1 a build pass and its grader each get the reply scripted for their role', () => {
  const p = setUp(makeProject as never)
  const o = runBuild(p)
  console.log(o.stdout, o.stderr)
  const builderAt = o.roles.indexOf('builder')
  const graderAt = o.roles.indexOf('grader')
  expect(builderAt).toBeGreaterThanOrEqual(0)
  expect(graderAt).toBeGreaterThanOrEqual(0)
  // The prompts hold no word that the scripted replies hold, so no reply was picked by its prompt.
  // The words that only the script holds: the builder's file content and the grader's gaps.
  expect(JSON.stringify(BUILDER)).toContain('zebra')
  expect(JSON.stringify(GRADER)).toContain('walrus')
  for (const w of ['zebra', 'quokka', 'walrus']) expect(o.prompts[builderAt]!).not.toContain(w)
  // The grader prompt holds the builder's diff, so only the grader reply's own words are absent from it.
  expect(o.prompts[graderAt]!).not.toContain('walrus')
  // The builder reply played in the builder launch: its edit is in the pass commit.
  expect(o.branchFiles).toContain('built.txt')
  // The grader reply played in the grader launch: the pass is graded and green.
  expect(o.code).toBe(0)
  expect(o.stdout).toContain('pass 1: green')
  // Only the builder reply edits: the grader launch made no edit (the branch holds the builder file only once, from pass 1).
  expect(o.branchFiles.toSorted()).toEqual(['Makefile', 'built.txt'])
}, LONG)

test('98.2 every agent of a full build and plan shows its role in the launch record', () => {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@true\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(p.dir, '.werk'))
  const events = [
    { type: 'node.proposed', payload: { id: 'map', kind: 'card', title: 'Map', status: 'decided', who: 'you' } },
    { type: 'node.proposed', payload: { id: 'map-reopen', kind: 'card', title: 'Reopen', status: 'decided', parent: 'map' } },
    { type: 'node.accepted', payload: { id: 'map-reopen' } },
  ]
  writeFileSync(
    join(p.dir, '.werk', 'log.jsonl'),
    events.map((e, i) => JSON.stringify({ actor: 'agent', ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z' })).join('\n') + '\n',
  )
  const PLAN = '.werk/plans/map'
  const edit = (path: string, content: string) => ({ edit: { path, content } })
  const ticket = [
    'title: A person can reopen a card',
    'cites: map-reopen, #map',
    'blocked_by:',
    'stories: 1',
    'touches: map view',
    '',
    '## What to build',
    '',
    'A person reopens a card.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] A reopened card shows as open.',
    '',
    '## Checks',
    '',
    '- `make check`',
    '',
  ].join('\n')
  const spec = '# Spec: reopen\n\n## Problem Statement\n\nNo reopen.\n\n## User Stories\n\n1. As a person, I want to reopen a card, so that I can change my mind.\n'
  const reply = (object: unknown) => ({
    steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
  })
  const toolUse = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'make check' } }] } } }
  const toolResult = { event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } }
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec), edit(`${PLAN}/spec.answers.json`, '[]')] },
      'ticket-writer': { steps: [edit(`${PLAN}/tickets/01-reopen.md`, ticket), edit(`${PLAN}/tickets.answers.json`, '[]')] },
      // The builder works long enough for the loop check to run once.
      builder: { steps: [toolUse, { sleep: 600 }, toolResult, edit('reopen.txt', 'reopen\n'), ...reply({}).steps] },
      grader: reply({ lines: ['ac-1', '#map', '#map-reopen'].map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
      'loop-classifier': { steps: [{ event: { type: 'result', subtype: 'success', result: 'progressing' } }] },
      'heldout-author': reply({ steps: [{ text: 'Given a card\nWhen the person reopens it\nThen it shows as open' }] }),
      'heldout-binder': reply({ steps: [{ id: '1.1', cmd: 'true' }] }),
    },
  })
  const plan = p.werk(['plan', 'map'])
  console.log('plan', plan.code, plan.stdout, plan.stderr)
  expect(plan.code).toBe(0)
  const run = p.werk(['run', 'map', '--parallel', '1', '--loop-every', '150'])
  console.log('run', run.code, run.stdout, run.stderr)
  const log = readFileSync(join(p.dir, '..', 'agent-launches.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const roles = log.map((l) => l.role as string)
  console.log(roles)
  expect(roles.filter((r) => r === 'spec-writer')).toHaveLength(1)
  expect(roles.filter((r) => r === 'ticket-writer')).toHaveLength(1)
  expect(roles.filter((r) => r === 'builder').length).toBeGreaterThanOrEqual(1)
  expect(roles.filter((r) => r === 'grader').length).toBe(roles.filter((r) => r === 'builder').length)
  expect(roles.filter((r) => r?.startsWith('reviewer'))).toHaveLength(5)
  expect(roles).toContain('loop-classifier')
  expect(roles).toContain('heldout-author')
  expect(roles).toContain('heldout-binder')
  for (const l of log) {
    expect(typeof l.role).toBe('string')
    expect(Array.isArray(l.argv)).toBe(true)
  }
  expect(run.code).toBe(0)
}, LONG)

test('98.4 a build pass with a permission ask plays one turn and exits with the script code', () => {
  const p = setUp(makeProject as never)
  const asking = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...BUILDER.steps], exit: 0 }
  const script = JSON.parse(readFileSync(p.env.WERK_FAKE_AGENT_SCRIPT!, 'utf8'))
  p.scriptAgent({ ...script, roles: { ...script.roles, builder: asking } })
  const started = performance.now()
  const o = runBuild(p)
  console.log(o.stdout, o.stderr)
  expect(performance.now() - started).toBeLessThan(60_000)
  expect(o.stdout).toContain('pass 1: the overseer answered a permission ask for Bash')
  expect(o.code).toBe(0)
  expect(o.stdout).toContain('pass 1: green')
  expect(o.roles.filter((r) => r === 'builder')).toHaveLength(1)
  const builderAt = o.roles.indexOf('builder')
  const inputs = p.agentInputs()[builderAt]!
  // One prompt, then the answer: no second user turn.
  expect(inputs.filter((m) => (m as { type?: string }).type === 'user')).toHaveLength(1)
  expect(inputs.some((m) => (m as { type?: string }).type === 'control_response')).toBe(true)
  expect(o.branchFiles).toContain('built.txt')
  const runs = join(p.dir, '.werk', 'runs')
  const record = sh(`cat ${JSON.stringify(runs)}/*.jsonl`, p.dir).out.trim().split('\n').map((l) => JSON.parse(l))
  expect(record[0]).toMatchObject({ agentExit: 0 })
}, LONG)

test('98.5 a reworded prompt does not change which reply a role gets', () => {
  const dir = freshClone()
  expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
  const out = join(mkdtempSync(join(tmpdir(), 'werk-heldout-98-5-')), 'outcomes.json')
  const inner = (name: string) => `import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { makeProject } from './test/harness.ts'
import { runBuild, setUp } from ${JSON.stringify(join(import.meta.dir, 'build-scenario.ts'))}
test(${JSON.stringify(name)}, () => {
  const o = runBuild(setUp(makeProject))
  appendFileSync(${JSON.stringify(out)}, JSON.stringify({ name: ${JSON.stringify(name)}, code: o.code, stdout: o.stdout, files: o.branchFiles, roles: o.roles, builderPrompt: o.prompts[o.roles.indexOf('builder')] }) + '\\n')
  expect(true).toBe(true)
}, 60_000)
`
  writeFileSync(join(dir, 'src/heldout-before.test.ts'), inner('before'))
  expect(sh('bun test ./src/heldout-before.test.ts', dir).code).toBe(0)
  // New wording of the builder prompt.
  const brief = join(dir, 'src/build/brief.ts')
  const text = readFileSync(brief, 'utf8')
  expect(text).toContain('in a werk builder loop for ticket')
  writeFileSync(brief, text.replace('in a werk builder loop for ticket', 'in a REWORDED-BUILD-PROMPT cycle for work item'))
  writeFileSync(join(dir, 'src/heldout-after.test.ts'), inner('after'))
  expect(sh('bun test ./src/heldout-after.test.ts', dir).code).toBe(0)
  const [before, after] = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  console.log(before.stdout, '\n---\n', after.stdout)
  expect(after.builderPrompt).toContain('REWORDED-BUILD-PROMPT')
  expect(before.builderPrompt).not.toContain('REWORDED-BUILD-PROMPT')
  expect(after.files).toContain('built.txt')
  expect(after.stdout).toContain('pass 1: green')
  expect(after.code).toBe(before.code)
  expect(after.files.toSorted()).toEqual(before.files.toSorted())
  expect(after.roles.filter((r: string) => !r?.startsWith("heldout")).toSorted()).toEqual(before.roles.filter((r: string) => !r?.startsWith("heldout")).toSorted())
}, 300_000)
