/** Held-out steps 86.1–86.5. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { authorOf, binderOf, judges, project, reply, ticketOf, writes, type Ctx } from './common.ts'

let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HO-STEP-A-MARK'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees HO-STEP-B-MARK'
const TEST_CODE = 'grep -q works feature.txt # HO-TEST-CODE-MARK\n'
const MAKEFILE = 'check:\n\t@true\n'
const binder = () => binderOf({ '3.1': 'sh .werk-heldout/3.1.sh', '3.2': 'true' }, { '.werk-heldout/3.1.sh': TEST_CODE })

function setup(tickets = [3]) {
  c = project(MAKEFILE, { 'feature.txt': 'works\n' }, tickets.map((n) => ticketOf(n)))
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': authorOf(STEP_A, STEP_B), 'heldout-binder': binder() } })
  return c
}
const commitFeature = (text: string) => {
  writeFileSync(join(c!.p.dir, 'feature.txt'), `${text}\n`)
  c!.p.run(['git', 'commit', '--quiet', '-am', `feature: ${text}`])
}

test('86.1 the builder never sees the held-out steps', () => {
  const x = setup()
  const r = x.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const roles = x.p.agentRoles()
  // The step author starts with the builder: during the build, before the grader of the first pass.
  expect(roles).toContain('heldout-author')
  expect(roles.indexOf('heldout-author')).toBeLessThan(roles.indexOf('grader'))
  expect(roles).toContain('heldout-binder')
  // The steps and the tests are outside the builder's worktree, in the store.
  const stored = JSON.parse(readFileSync(join(x.store, 'steps-3.json'), 'utf8'))
  expect(stored.steps.map((s: { text: string }) => s.text)).toEqual([STEP_A, STEP_B])
  expect(readFileSync(join(x.store, 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  // No file in the builder's worktree (its pass commits hold every file of it) holds step text.
  const branches = x.git('branch', '--format=%(refname:short)').split('\n').filter((b) => b.startsWith('werk-build/'))
  expect(branches.length).toBeGreaterThan(0)
  for (const b of branches) expect(x.p.run(['git', 'grep', '-q', 'HO-STEP-', b]).code).toBe(1)
  const prompts = x.prompts('builder')
  expect(prompts.length).toBeGreaterThan(0)
  for (const pr of prompts) expect(pr).not.toContain('HO-STEP-')
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  const x = setup()
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  commitFeature('broken')
  const r = x.p.werk(['heldout', 'root'])
  expect(r.stdout).toContain('red 3.1')
  expect(r.stdout).toContain('HO-STEP-A-MARK')
  expect(r.stdout).toContain('green 3.2')
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  const x = setup()
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  commitFeature('broken')
  expect(x.p.werk(['heldout', 'root']).code).toBe(1)
  // The next pass on the ticket: the ticket goes back to ready and builds again.
  x.appendBoard({ type: 'ticket.moved', payload: { number: 3, to: 'ready' } })
  x.p.werk(['build', '3', '--cap', '1'])
  const prompt = x.prompts('builder').at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('HO-TEST-CODE-MARK')
  expect(prompt).not.toContain('grep -q works feature.txt')
  expect(prompt).not.toContain('HO-STEP-B-MARK')
}, 60_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const x = setup()
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  const gatesBefore = x.events().filter((e) => e.type === 'gate.opened').length
  commitFeature('broken')
  expect(x.p.werk(['heldout', 'root']).code).toBe(1)
  const g = x.p.werk(['gate', 'root'])
  expect(g.code).not.toBe(0)
  expect(g.stdout + g.stderr).toContain('step 3.1 is red')
  expect(g.stdout).toContain('G2 stays closed')
  expect(x.events().filter((e) => e.type === 'gate.opened')).toHaveLength(gatesBefore)
  expect(x.events().at(-1)!.type).not.toBe('gate.opened')
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  const x = setup()
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  commitFeature('broken')
  expect(x.p.werk(['heldout', 'root']).code).toBe(1)
  expect(x.p.werk(['gate', 'root']).code).toBe(1)
  commitFeature('works')
  const h = x.p.werk(['heldout', 'root'])
  expect(h.code).toBe(0)
  expect(h.stdout).toContain('green 3.1')
  expect(h.stdout).toContain('green 3.2')
  const g = x.p.werk(['gate', 'root'])
  expect(g.code).toBe(0)
  expect(g.stdout).toContain('G2 is open for root')
  const tip = x.git('rev-parse', 'main')
  expect(x.events().at(-1)).toMatchObject({ type: 'gate.opened', payload: { gate: 'G2', root: 'root', commit: tip } })
}, 60_000)
