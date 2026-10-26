/**
 * Held-out tests for scenario group 86: the held-out pipeline (step author, binder, held-out run, gate).
 * Reading: "a run" is the plan run of subtree "root" (`werk run root`); "the run's tree" is the tip of
 * the main line that the run merges onto, which is where `werk heldout` and `werk gate` work.
 */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { binderOf, judges, MAIN, project, readText, reply, ticketOf, until, type Ctx } from './util.ts'

let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEPONE-MARK'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees STEPTWO-MARK'
const TEST_CODE = 'grep -q works feature.txt # TESTCODE-MARK\n'
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }] })
const binder = binderOf({ '3.1': 'sh .werk-heldout/3.1.sh', '3.2': 'true' }, [{ edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } }])
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, ...reply({}).steps] }

function setup(tickets = [3]) {
  c = project({ makefile: 'check:\n\t@true\n', files: { 'feature.txt': 'works\n' }, tickets: tickets.map((n) => ticketOf(n)) })
  return c
}

/** The run of subtree root, done: ticket 3 merged, held-out set bound and green on the tip. */
function runDone(ctx: Ctx) {
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [builder], 'heldout-author': author, 'heldout-binder': [binder] } })
  const r = ctx.p.werk(['run', 'root', '--parallel', '1'])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
  expect(ctx.columnOf(3)).toBe('done')
  return r
}

/*
 * 86.1
 * Scenario: The builder never sees the held-out steps
 * Given a planned ticket with acceptance criteria on the board
 * And a person starts the build of that ticket
 * When the builder starts work on the ticket
 * Then a step author starts at the same time and writes Given, When, Then steps from the ticket
 * And a binder turns those steps into tests
 * And the person finds the steps and the tests outside the builder's worktree
 * But no file in the builder's worktree holds any held-out step text
 * And no prompt the builder receives holds any held-out step text
 */
test('86.1 the builder never sees the held-out steps', async () => {
  const ctx = setup()
  const { p } = ctx
  const release = join(p.dir, '..', 'release-builder')
  const holding: FakeReply = { steps: [{ waitFor: release }, { edit: { path: 'work.txt', content: 'started\n' } }, ...reply({}).steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [holding], 'heldout-author': author, 'heldout-binder': [binder] } })

  // The person starts the build: the plan run of the subtree, which builds the ticket, merges it, and binds the set.
  const child = Bun.spawn([process.execPath, MAIN, 'run', 'root', '--parallel', '1'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const done = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  try {
    await until('the builder launch', () => p.agentRoles().includes('builder'))
    // The step author starts while the builder works, and writes its steps to the store.
    const stepsFile = join(ctx.store(), 'steps-3.json')
    await until('the author steps', () => existsSync(stepsFile))
    expect(p.agentRoles()).toContain('heldout-author')
    const stored = JSON.parse(readText(stepsFile))
    expect(stored.steps.map((s: { text: string }) => s.text)).toEqual([STEP_A, STEP_B])
    for (const s of stored.steps as { text: string }[]) expect(s.text).toMatch(/^Given [\s\S]*\nWhen [\s\S]*\nThen /)

    // The builder's worktree, while the builder works: no file holds a step text.
    const trees = p.run(['git', 'worktree', 'list', '--porcelain']).stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))
    const builderTree = trees.find((t) => t.includes('werk-build-'))
    expect(builderTree).toBeDefined()
    expect(stepsFile.startsWith(builderTree!)).toBe(false)
    const hits = p.run(['grep', '-r', '-l', '-e', 'STEPONE-MARK', '-e', 'STEPTWO-MARK', builderTree!])
    expect(hits.stdout).toBe('')
  } finally {
    writeFileSync(release, '')
  }
  const [code, stdout, stderr] = await done
  expect(stderr).toBe('')
  expect(code).toBe(0)

  // A binder ran and turned the steps into tests, kept in the store outside the worktree.
  expect(p.agentRoles()).toContain('heldout-binder')
  expect(ctx.promptsOf('heldout-binder')[0]).toContain(STEP_A)
  expect(readText(join(ctx.store(), 'tests', '3.1.sh'))).toBe(TEST_CODE)
  expect(stdout).toContain('green 3.1')

  // The builder's branch (its worktree content) holds no step text and no test.
  const branch = /werk-build\/[\w-]+/.exec(stdout)![0]
  expect(p.run(['git', 'grep', '-q', '-e', 'STEPONE-MARK', '-e', 'STEPTWO-MARK', '-e', 'TESTCODE-MARK', branch]).code).toBe(1)
  // No builder prompt holds step text.
  const prompts = ctx.promptsOf('builder')
  expect(prompts.length).toBeGreaterThan(0)
  for (const pr of prompts) {
    expect(pr).not.toContain('STEPONE-MARK')
    expect(pr).not.toContain('STEPTWO-MARK')
    expect(pr).not.toContain('When the user opens the feature')
  }
}, 120_000)

/*
 * 86.2
 * Scenario: A held-out run on a broken tree reports the red step
 * Given a run whose ticket has held-out steps and bound tests
 * And the run's tree has a break that one user path hits
 * When the person runs the held-out set on the run's tree
 * Then the result names the step whose path hits the break as red
 * And the result shows the other steps as green
 * And the held-out run exits with a failure
 */
test('86.2 a held-out run on a broken tree reports the red step', () => {
  const ctx = setup()
  runDone(ctx)
  expect(readText(join(ctx.store(), 'tests', '3.1.sh'))).toBe(TEST_CODE)
  ctx.commit('feature.txt', 'broken\n', 'break the feature')

  const r = ctx.p.werk(['heldout', 'root'])
  expect(r.stdout).toMatch(/red 3\.1/)
  expect(r.stdout).toMatch(/green 3\.2/)
  expect(r.code).not.toBe(0)
  const ran = ctx.events().findLast((e) => e.type === 'heldout.ran') as { payload: { commit: string; steps: { id: string; result: string }[] } }
  expect(ran.payload.commit).toBe(ctx.git('rev-parse', 'main'))
  expect(ran.payload.steps.map((s) => [s.id, s.result])).toEqual([
    ['3.1', 'red'],
    ['3.2', 'green'],
  ])
}, 120_000)

/*
 * 86.3
 * Scenario: The builder gets the failed step's text, not the test
 * Given a held-out run on the run's tree reported one red step
 * When the builder starts its next pass on the ticket
 * Then the builder's prompt holds the Given, When, Then text of the red step
 * But the builder's prompt holds none of the test code bound to that step
 * And the builder's prompt holds no text of the steps that passed
 */
test('86.3 the builder gets the failed step text, not the test', () => {
  const ctx = setup()
  runDone(ctx)
  ctx.commit('feature.txt', 'broken\n', 'break the feature')
  expect(ctx.p.werk(['heldout', 'root']).code).toBe(1)

  // The ticket goes back to ready and the person builds it again: its next builder pass.
  ctx.appendBoard({ type: 'ticket.moved', payload: { number: 3, to: 'ready' } })
  const before = ctx.promptsOf('builder').length
  ctx.p.werk(['build', '3', '--cap', '1'])
  const prompts = ctx.promptsOf('builder')
  expect(prompts.length).toBe(before + 1)
  const prompt = prompts.at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('TESTCODE-MARK')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('.werk-heldout/3.1.sh')
  expect(prompt).not.toContain('STEPTWO-MARK')
  expect(prompt).not.toContain('When the user saves a file')
}, 120_000)

/*
 * 86.4
 * Scenario: The gate refuses G2 while a held-out step is red
 * Given a run where every ticket is built
 * And the last held-out run on the run's tree reported one red step
 * When the person asks the gate to open G2
 * Then the gate refuses and exits with a failure
 * And the gate names the red held-out step as the reason
 * And G2 stays closed
 */
test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const ctx = setup()
  runDone(ctx)
  ctx.commit('feature.txt', 'broken\n', 'break the feature')
  expect(ctx.p.werk(['heldout', 'root']).code).toBe(1)
  const gatesBefore = ctx.gates().length

  const r = ctx.p.werk(['gate', 'root'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toContain('3.1')
  expect(r.stdout).toMatch(/3\.1 is red/)
  expect(r.stdout).toContain('G2 stays closed')
  // G2 stays closed: no gate.opened for the current tip, and none appended by the refusal.
  expect(ctx.gates().length).toBe(gatesBefore)
  expect(ctx.gates()).not.toContain(ctx.git('rev-parse', 'main'))
}, 120_000)

/*
 * 86.5
 * Scenario: G2 opens after the red step turns green
 * Given a run where the gate refused G2 because of one red held-out step
 * And the builder fixed the break on the run's tree
 * When the person runs the held-out set on the run's tree again
 * And every held-out step is green
 * And the person asks the gate to open G2
 * Then the gate succeeds
 * And G2 shows as open for the run
 */
test('86.5 G2 opens after the red step turns green', () => {
  const ctx = setup()
  runDone(ctx)
  ctx.commit('feature.txt', 'broken\n', 'break the feature')
  expect(ctx.p.werk(['heldout', 'root']).code).toBe(1)
  expect(ctx.p.werk(['gate', 'root']).code).toBe(1)

  // The fix of the break lands on the run's tree.
  ctx.commit('feature.txt', 'works\n', 'fix the feature')
  const h = ctx.p.werk(['heldout', 'root'])
  expect(h.code).toBe(0)
  expect(h.stdout).toContain('green 3.1')
  expect(h.stdout).toContain('green 3.2')

  const g = ctx.p.werk(['gate', 'root'])
  expect(g.stderr).toBe('')
  expect(g.code).toBe(0)
  const tip = ctx.git('rev-parse', 'main')
  expect(g.stdout).toContain(`G2 is open for root at ${tip.slice(0, 12)}`)
  // Reading of "G2 shows as open": the board log holds gate.opened for G2, root, the current tip.
  const last = ctx.events().findLast((e) => e.type === 'gate.opened') as { payload: { gate: string; root: string; commit: string } }
  expect(last.payload).toEqual({ gate: 'G2', root: 'root', commit: tip })
  expect(readdirSync(ctx.store()).length).toBeGreaterThan(0)
}, 120_000)
