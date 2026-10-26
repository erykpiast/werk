/** Held-out steps 86.1 to 86.5: the held-out set, its feedback and the G2 gate. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { project, reply, resultStep, ticketOf, type Ctx } from './common.ts'

let c: Ctx
afterEach(() => c?.p.run(['git', 'worktree', 'prune']))

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HELDOUT-ALPHA-MARK'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees HELDOUT-BETA-MARK'
const TEST_CODE = 'grep -q works feature.txt # BOUND-TEST-MARK\n'
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }] })
const binder: FakeReply = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...reply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps,
  ],
}
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, resultStep] }
const MAKEFILE = 'check:\n\t@echo the check is red; exit 1\n'
const store = () => join(c.werk, 'heldout', 'root')

function commitFeature(text: string) {
  writeFileSync(join(c.p.dir, 'feature.txt'), `${text}\n`)
  c.p.run(['git', 'add', 'feature.txt'])
  c.p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}

/** A run with ticket 3 built (step author ran) and done, and the feature working on main. */
function builtRun(tickets = [3]) {
  c = project(MAKEFILE, tickets.map((n) => ticketOf(n)), { 'feature.txt': 'works\n' })
  c.p.scriptAgent({ steps: [], roles: { builder: [builder], 'heldout-author': author, 'heldout-binder': binder } })
  expect(c.p.werk(['build', '3', '--cap', '1']).code).toBe(1)
  c.appendBoard({ type: 'ticket.moved', payload: { number: 3, to: 'done' } })
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.name === '.git' ? [] : d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  )

test('86.1 the builder never sees the held-out steps', async () => {
  c = project(MAKEFILE, [ticketOf(3)], { 'feature.txt': 'works\n' })
  const release = join(c.p.dir, '..', 'release-builder')
  // The builder waits in its worktree until the test has looked at it.
  const waiting: FakeReply = { steps: [{ waitFor: release }, { edit: { path: 'work.txt', content: 'started\n' } }, resultStep] }
  c.p.scriptAgent({ steps: [], roles: { builder: [waiting], 'heldout-author': author, 'heldout-binder': binder } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'build', '3', '--cap', '1'], {
    cwd: c.p.dir,
    env: c.p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stepsFile = join(store(), 'steps-3.json')
  for (const end = Date.now() + 20_000; Date.now() < end && !(existsSync(stepsFile) && c.p.agentRoles().includes('builder')); ) await Bun.sleep(50)
  // The step author wrote its steps while the builder still works: both started together.
  expect(existsSync(stepsFile)).toBe(true)
  expect(c.p.agentRoles()).toContain('builder')
  const worktree = c.git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9))
    .find((d) => d.includes('werk-build-'))!
  expect(worktree).toBeDefined()
  for (const f of walk(worktree)) expect(readFileSync(f, 'utf8')).not.toMatch(/HELDOUT-(ALPHA|BETA)-MARK/)
  writeFileSync(release, '')
  await child.exited

  c.appendBoard({ type: 'ticket.moved', payload: { number: 3, to: 'done' } })
  expect(c.p.werk(['heldout', 'root']).code).toBe(0)
  // The steps and the tests are in the store, outside the worktree and outside every commit.
  expect(readFileSync(stepsFile, 'utf8')).toContain('HELDOUT-ALPHA-MARK')
  expect(readFileSync(join(store(), 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  const branch = c.git('branch', '--format=%(refname:short)').split('\n').find((b) => b.startsWith('werk-build/'))!
  expect(c.p.run(['git', 'grep', '-q', 'HELDOUT-', branch]).code).toBe(1)
  for (const prompt of c.prompts('builder')) expect(prompt).not.toMatch(/HELDOUT-(ALPHA|BETA)-MARK|When the user (opens the feature|saves a file)/)
}, 40_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  builtRun()
  commitFeature('broken')
  const r = c.p.werk(['heldout', 'root'])
  expect(r.stdout).toContain(`red 3.1\n${STEP_A.replace(/^/gm, '    ')}`)
  expect(r.stdout).toContain('green 3.2')
  expect(r.code).not.toBe(0)
}, 40_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  builtRun([3, 4])
  commitFeature('broken')
  expect(c.p.werk(['heldout', 'root']).code).toBe(1)
  // The next pass on a ticket of the run.
  c.p.werk(['build', '4', '--cap', '1'])
  const prompt = c.prompts('builder').at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('BOUND-TEST-MARK')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('HELDOUT-BETA-MARK')
}, 40_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  builtRun()
  commitFeature('broken')
  expect(c.p.werk(['heldout', 'root']).code).toBe(1)
  const gate = c.p.werk(['gate', 'root'])
  expect(gate.code).not.toBe(0)
  expect(gate.stdout + gate.stderr).toContain('3.1')
  expect(gate.stdout + gate.stderr).toMatch(/3\.1 is red/)
  expect(c.events().filter((e) => e.type === 'gate.opened')).toEqual([])
}, 40_000)

test('86.5 G2 opens after the red step turns green', () => {
  builtRun()
  commitFeature('broken')
  expect(c.p.werk(['heldout', 'root']).code).toBe(1)
  expect(c.p.werk(['gate', 'root']).code).toBe(1)
  commitFeature('works')
  const again = c.p.werk(['heldout', 'root'])
  expect(again.stdout).toContain('every held-out step is green')
  const gate = c.p.werk(['gate', 'root'])
  expect(gate.code).toBe(0)
  expect(gate.stdout).toContain('G2 is open for root')
  expect(c.events().filter((e) => e.type === 'gate.opened')).toEqual([
    expect.objectContaining({ payload: { gate: 'G2', root: 'root', commit: c.git('rev-parse', 'main') } }),
  ])
}, 40_000)
