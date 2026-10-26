/** Held-out steps 86.1 - 86.5: the held-out set, its feedback to the builder, and the G2 gate. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, TicketFields } from '../../src/board/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { allInputs, appendBoard, boardFile, branchOf, git, judgeReply, judges, makeBuildProject, result, werkDir } from './helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

const STEP_ONE = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-ONE-MARK'
const STEP_TWO = 'Given the product is installed\nWhen the user saves a file\nThen the user sees STEP-TWO-MARK'
const TEST_CODE = 'grep -q works feature.txt # TEST-CODE-MARK\n'

const ticket: TicketFields = {
  number: 3,
  title: 'The feature works',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['feature'],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
}
const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
const LINES = ['ac-1', '#loop']

const store = (p: Project) => join(werkDir(p), 'heldout', 'root')
const author: FakeReply = judgeReply({ steps: [{ text: STEP_ONE }, { text: STEP_TWO }] })
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
const binder: FakeReply = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...judgeReply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps,
  ],
}

function commitFeature(p: Project, text: string) {
  writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}

function setup(): Project {
  p = makeBuildProject({ makefile: 'check:\n\t@echo the check is green\n', ticket, log, files: { 'feature.txt': 'works\n' } })
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [builder], 'heldout-author': author, 'heldout-binder': binder } })
  return p
}

/** Builds ticket 3 so its step author writes the steps, marks it done, and binds the set on a working main. */
function builtAndBound(p: Project) {
  p.werk(['build', '3', '--cap', '1'])
  appendBoard(p, { type: 'ticket.moved', payload: { number: 3, to: 'done' } })
  const bound = p.werk(['heldout', 'root'])
  expect(bound.code).toBe(0)
  expect(existsSync(join(store(p), 'tests', '3.1.sh'))).toBe(true)
}

const gatesOpened = (p: Project) => readLog<BoardEvent>(boardFile(p)).filter((e) => e.type === 'gate.opened')

test('86.1 the builder never sees the held-out steps', () => {
  const p = setup()
  const marker = join(store(p), 'author-started')
  // The author marks that it runs; the builder waits for that mark, so both run at the same time.
  const author1: FakeReply = { steps: [{ edit: { path: 'author-started', content: 'x' } }, ...author.steps] }
  const builder1: FakeReply = { steps: [{ waitFor: marker }, { edit: { path: 'done.txt', content: 'done\n' } }, result(0.1)] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [builder1], 'heldout-author': author1, 'heldout-binder': binder } })
  const r = p.werk(['run', 'root', '--agent-timeout', '20000'])
  const roles = p.agentRoles()
  // A step author starts at the same time as the builder and writes Given, When, Then steps.
  expect(roles).toContain('heldout-author')
  expect(existsSync(marker)).toBe(true)
  const stepsFile = join(store(p), 'steps-3.json')
  expect(existsSync(stepsFile)).toBe(true)
  const stored = JSON.parse(readFileSync(stepsFile, 'utf8'))
  expect(stored.steps.length).toBeGreaterThan(0)
  for (const s of stored.steps) expect(s.text).toMatch(/Given[\s\S]*When[\s\S]*Then/)
  // A binder turns those steps into tests.
  expect(roles).toContain('heldout-binder')
  const testFile = join(store(p), 'tests', '3.1.sh')
  expect(existsSync(testFile)).toBe(true)
  expect(readFileSync(testFile, 'utf8')).toContain('TEST-CODE-MARK')
  // The steps and the tests are outside the builder's worktree: not in any commit of the ticket branch.
  const branch = branchOf(r.stdout)
  expect(git(p, 'ls-tree', '-r', '--name-only', branch)).not.toContain('heldout')
  // No file in the builder's worktree holds held-out step text.
  for (const mark of ['STEP-ONE-MARK', 'STEP-TWO-MARK', 'TEST-CODE-MARK']) expect(p.run(['git', 'grep', '-q', mark, branch]).code).toBe(1)
  expect(p.run(['git', 'check-ignore', '-q', '.werk/heldout/root/steps-3.json']).code).toBe(0)
  // No prompt the builder receives holds held-out step text.
  const inputs = allInputs(p, 'builder')
  expect(inputs.length).toBeGreaterThan(0)
  for (const line of inputs) {
    expect(line).not.toContain('STEP-ONE-MARK')
    expect(line).not.toContain('STEP-TWO-MARK')
  }
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  const p = setup()
  builtAndBound(p)
  commitFeature(p, 'broken')
  const r = p.werk(['heldout', 'root'])
  // The result names the step whose path hits the break as red.
  expect(r.stdout).toMatch(/red 3\.1/)
  expect(r.stdout).toContain('STEP-ONE-MARK')
  // The other steps are green.
  expect(r.stdout).toContain('green 3.2')
  const ran = readLog<BoardEvent>(boardFile(p)).findLast((e) => e.type === 'heldout.ran')
  expect(ran).toMatchObject({ payload: { steps: [{ id: '3.1', result: 'red' }, { id: '3.2', result: 'green' }] } })
  // The held-out run exits with a failure.
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  const p = setup()
  builtAndBound(p)
  commitFeature(p, 'broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  // The builder starts its next pass on the ticket.
  appendBoard(p, { type: 'ticket.moved', payload: { number: 3, to: 'ready' } })
  const before = allInputs(p, 'builder').length
  p.werk(['build', '3', '--cap', '1'])
  const roles = p.agentRoles()
  const lastBuilder = roles.lastIndexOf('builder')
  expect(lastBuilder).toBeGreaterThanOrEqual(0)
  const prompt = p
    .agentInputs()
    [lastBuilder]!.map((l) => JSON.stringify(l))
    .join('\n')
  expect(allInputs(p, 'builder').length).toBeGreaterThan(before)
  // The prompt holds the Given, When, Then text of the red step.
  const text = (p.agentInputs()[lastBuilder]!.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } }).message.content
  expect(text).toContain(STEP_ONE)
  // It holds none of the test code bound to that step.
  expect(prompt).not.toContain('TEST-CODE-MARK')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('3.1.sh')
  // It holds no text of the steps that passed.
  expect(prompt).not.toContain('STEP-TWO-MARK')
  expect(prompt).not.toContain('When the user saves a file')
}, 60_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const p = setup()
  builtAndBound(p)
  commitFeature(p, 'broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  const opened = gatesOpened(p).length
  const g = p.werk(['gate', 'root'])
  // The gate refuses and exits with a failure.
  expect(g.code).not.toBe(0)
  // It names the red held-out step as the reason.
  expect(g.stdout + g.stderr).toMatch(/3\.1 is red/)
  // G2 stays closed.
  expect(gatesOpened(p).length).toBe(opened)
  expect(g.stdout).not.toContain('G2 is open')
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  const p = setup()
  builtAndBound(p)
  commitFeature(p, 'broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  expect(p.werk(['gate', 'root']).code).not.toBe(0)
  // The builder fixed the break on the run's tree.
  commitFeature(p, 'works')
  // The person runs the held-out set again, and every step is green.
  const again = p.werk(['heldout', 'root'])
  expect(again.code).toBe(0)
  expect(again.stdout).toContain('green 3.1')
  expect(again.stdout).toContain('green 3.2')
  // The gate succeeds.
  const g = p.werk(['gate', 'root'])
  expect(g.code).toBe(0)
  // G2 shows as open for the run.
  expect(g.stdout).toContain('G2 is open for root')
  expect(gatesOpened(p).at(-1)).toMatchObject({ payload: { gate: 'G2', root: 'root', commit: git(p, 'rev-parse', 'main') } })
}, 60_000)
