/** Held-out steps 86.1–86.5: the held-out set, its feedback, and the G2 gate. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { appendBoard, boardEvents, git, judges, project, prompts, reply, ticketOf, writes } from './common.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-ONE-MARK'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees STEP-TWO-MARK'
const TEST_CODE = 'grep -q works feature.txt # TEST-CODE-MARK\n'
const MAKEFILE = 'check:\n\t@true\n'
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }] })
const binder: FakeReply = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...reply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps,
  ],
}
const store = () => join(p.dir, '.werk', 'heldout', 'root')
const commitFeature = (text: string) => {
  writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}
/** A ticket built and merged by the run, so its steps exist and are bound. */
function builtAndBound() {
  p = project(MAKEFILE, [ticketOf(3)], { 'feature.txt': 'works\n' })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt')], 'heldout-author': author, 'heldout-binder': [binder] } })
  return p.werk(['run', 'root'])
}

test('86.1 the builder never sees the held-out steps', () => {
  const r = builtAndBound()
  const roles = p.agentRoles()
  // A step author started with the builder.
  expect(roles).toContain('heldout-author')
  expect(roles.indexOf('heldout-author')).toBeLessThan(roles.indexOf('grader'))
  // A binder turned the steps into tests.
  expect(roles).toContain('heldout-binder')
  // The steps and the tests are outside the builder's worktree: in the store.
  const stored = readFileSync(join(store(), 'steps-3.json'), 'utf8')
  expect(stored).toContain('STEP-ONE-MARK')
  expect(existsSync(join(store(), 'tests', '3.1.sh'))).toBe(true)
  // No file of the builder's branch holds any step text.
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(p.run(['git', 'grep', '-q', '-e', 'STEP-ONE-MARK', '-e', 'STEP-TWO-MARK', '-e', 'user opens the feature', branch]).code).toBe(1)
  // No builder prompt holds any step text.
  for (const prompt of prompts(p, 'builder')) {
    expect(prompt).not.toContain('STEP-ONE-MARK')
    expect(prompt).not.toContain('STEP-TWO-MARK')
  }
  expect(prompts(p, 'builder').length).toBeGreaterThan(0)
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  builtAndBound()
  commitFeature('broken')
  p.scriptAgent({ steps: [], roles: { 'heldout-binder': [binder] } })
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toMatch(/^red 3\.1$/m)
  expect(r.stdout).toMatch(/^green 3\.2$/m)
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  builtAndBound()
  commitFeature('broken')
  p.scriptAgent({ steps: [], roles: { 'heldout-binder': [binder] } })
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  // The ticket goes back to ready, so the builder starts its next pass on it.
  appendBoard(p, { type: 'ticket.moved', payload: { number: 3, to: 'ready' } })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3b.txt')] } })
  p.werk(['build', '3', '--cap', '1'])
  const prompt = prompts(p, 'builder').at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('TEST-CODE-MARK')
  expect(prompt).not.toContain('grep -q works feature.txt')
  expect(prompt).not.toContain('STEP-TWO-MARK')
}, 60_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  builtAndBound()
  commitFeature('broken')
  p.scriptAgent({ steps: [], roles: { 'heldout-binder': [binder] } })
  p.werk(['heldout', 'root'])
  const opened = boardEvents(p).filter((e) => e.type === 'gate.opened').length
  const r = p.werk(['gate', 'root'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('step 3.1 is red')
  expect(boardEvents(p).filter((e) => e.type === 'gate.opened').length).toBe(opened)
  expect(boardEvents(p).findLast((e) => e.type === 'gate.opened' || e.type === 'heldout.ran')?.type).toBe('heldout.ran')
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  builtAndBound()
  commitFeature('broken')
  p.scriptAgent({ steps: [], roles: { 'heldout-binder': [binder] } })
  p.werk(['heldout', 'root'])
  expect(p.werk(['gate', 'root']).code).not.toBe(0)
  // The builder fixed the break on the run's tree.
  commitFeature('works')
  const h = p.werk(['heldout', 'root'])
  expect(h.stdout).toContain('every held-out step is green')
  expect(h.code).toBe(0)
  const r = p.werk(['gate', 'root'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('G2 is open for root')
  const last = boardEvents(p).findLast((e) => e.type === 'gate.opened')
  expect(last).toMatchObject({ payload: { gate: 'G2', root: 'root', commit: git(p, 'rev-parse', 'main') } })
}, 60_000)

