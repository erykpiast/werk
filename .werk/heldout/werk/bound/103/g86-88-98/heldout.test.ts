/** Held-out steps 86.1 to 86.5: the held-out set. */
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { binder, judges, project, reply, ticketOf, writes, type Ctx } from './common.ts'

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEPA-MARK'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees STEPB-MARK'
const TEST_CODE = 'grep -q works feature.txt # TESTCODE-MARK\n'
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }] })
const bind = binder({ '3.1': 'sh .werk-heldout/3.1.sh', '3.2': 'true' }, [{ edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } }])

function setup(tickets = [3]): Ctx {
  const ctx = project(tickets, { makefile: 'check:\n\t@true\n', files: { 'feature.txt': 'works\n' } })
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': bind } })
  return ctx
}
function commitFeature(ctx: Ctx, text: string) {
  writeFileSync(join(ctx.p.dir, 'feature.txt'), `${text}\n`)
  ctx.p.run(['git', 'add', 'feature.txt'])
  ctx.p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}
const store = (ctx: Ctx) => join(ctx.werk(), 'heldout', 'root')

test('86.1 the builder never sees the held-out steps', () => {
  const ctx = setup()
  const r = ctx.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  const roles = ctx.p.agentRoles()
  // The step author starts during the first build pass: before the pass's grader.
  const authorAt = roles.indexOf('heldout-author')
  expect(authorAt).toBeGreaterThanOrEqual(0)
  expect(authorAt).toBeLessThan(roles.indexOf('grader'))
  expect(roles).toContain('heldout-binder')
  // The steps and the tests are in the store, outside the builder's worktree.
  const steps = readFileSync(join(store(ctx), 'steps-3.json'), 'utf8')
  expect(steps).toContain('STEPA-MARK')
  expect(readFileSync(join(store(ctx), 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(ctx.p.run(['git', 'grep', '-q', 'STEP', branch]).code).toBe(1)
  expect(ctx.p.run(['git', 'grep', '-q', 'STEP', 'main']).code).toBe(1)
  const builder = ctx.prompts('builder')
  expect(builder.length).toBeGreaterThan(0)
  for (const prompt of builder) {
    expect(prompt).not.toContain('STEPA-MARK')
    expect(prompt).not.toContain('STEPB-MARK')
  }
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  const ctx = setup()
  expect(ctx.p.werk(['run', 'root']).code).toBe(0)
  commitFeature(ctx, 'broken')
  const r = ctx.p.werk(['heldout', 'root'])
  expect(r.stdout).toMatch(/red 3\.1/)
  expect(r.stdout).toMatch(/green 3\.2/)
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  const ctx = setup()
  expect(ctx.p.werk(['run', 'root']).code).toBe(0)
  // A held-out run on the run's tree reported one red step.
  commitFeature(ctx, 'broken')
  expect(ctx.p.werk(['heldout', 'root']).stdout).toMatch(/red 3\.1/)
  // The builder's next pass on a ticket of the subtree.
  ctx.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  ctx.p.werk(['build', '4', '--cap', '1'])
  const prompt = ctx.prompts('builder').at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('TESTCODE-MARK')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('STEPB-MARK')
}, 90_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const ctx = setup()
  expect(ctx.p.werk(['run', 'root']).code).toBe(0)
  expect(ctx.columnOf(3)).toBe('done')
  commitFeature(ctx, 'broken')
  expect(ctx.p.werk(['heldout', 'root']).code).not.toBe(0)
  const before = ctx.gates().length
  const g = ctx.p.werk(['gate', 'root'])
  expect(g.code).not.toBe(0)
  expect(g.stdout + g.stderr).toContain('3.1')
  expect(g.stdout + g.stderr).toMatch(/red/)
  expect(ctx.gates().length).toBe(before)
  expect(ctx.gates()).not.toContain(ctx.git('rev-parse', 'main'))
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  const ctx = setup()
  expect(ctx.p.werk(['run', 'root']).code).toBe(0)
  commitFeature(ctx, 'broken')
  expect(ctx.p.werk(['heldout', 'root']).code).not.toBe(0)
  expect(ctx.p.werk(['gate', 'root']).code).not.toBe(0)
  commitFeature(ctx, 'works')
  const h = ctx.p.werk(['heldout', 'root'])
  expect(h.code).toBe(0)
  expect(h.stdout).toContain('every held-out step is green')
  const g = ctx.p.werk(['gate', 'root'])
  expect(g.code).toBe(0)
  expect(g.stdout).toContain('G2 is open for root')
  expect(ctx.gates().at(-1)).toBe(ctx.git('rev-parse', 'main'))
}, 60_000)
