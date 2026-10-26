/** Held-out steps 86.1 to 86.5: the held-out set, its feedback to the builder, and the G2 gate. */
import { test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { binder, expect, judges, MAIN_CLI, reply, setup, ticketOf, type Ctx } from './helpers.ts'

const STEP_SEARCH = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-ONE-MARK'
const STEP_SAVE = 'Given the product is installed\nWhen the user saves a file\nThen the user sees STEP-TWO-MARK'
const TEST_CODE = 'grep -q works feature.txt # TEST-CODE-MARK\n'
const author = reply({ steps: [{ text: STEP_SEARCH }, { text: STEP_SAVE }] })
const bindTests: FakeReply = {
  steps: [{ edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } }, ...binder({ '3.1': 'sh .werk-heldout/3.1.sh', '3.2': 'true' }).steps],
}
const GREEN_CHECK = 'check:\n\t@true\n'

const store = (c: Ctx) => join(c.p.dir, '.werk', 'heldout', 'root')
const commitFeature = (c: Ctx, text: string) => {
  writeFileSync(join(c.p.dir, 'feature.txt'), `${text}\n`)
  c.p.run(['git', 'add', 'feature.txt'])
  c.p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}

async function until(what: string, ok: () => boolean, ms = 20_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (ok()) return
  throw new Error(`timed out waiting for ${what}`)
}

/** Grep a folder for a text, recursively, outside .git. */
const holds = (dir: string, text: string): string[] => {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const path = join(d, e.name)
      if (e.isDirectory()) walk(path)
      else if (readFileSync(path, 'utf8').includes(text)) hits.push(path)
    }
  }
  walk(dir)
  return hits
}

test('86.1 the builder never sees the held-out steps', async () => {
  const c = setup(GREEN_CHECK, [ticketOf(3)], { 'feature.txt': 'works\n' })
  const slowBuilder: FakeReply = { steps: [{ sleep: 3000 }, { edit: { path: 'work.txt', content: 'started\n' } }, ...reply({}).steps] }
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowBuilder], 'heldout-author': author, 'heldout-binder': bindTests } })

  // The person starts the build of the ticket (through the run, which also merges it and binds the set).
  const child = Bun.spawn([process.execPath, MAIN_CLI, 'run', 'root'], { cwd: c.p.dir, env: c.p.env, stdout: 'pipe', stderr: 'pipe' })
  const done = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])

  await until('the builder launch', () => c.p.agentRoles().includes('builder'))
  // The step author starts at the same time: while the builder still works.
  await until('the step author launch', () => c.p.agentRoles().includes('heldout-author'), 2500)
  await until('the steps file', () => existsSync(join(store(c), 'steps-3.json')), 2500)
  const trees = c
    .git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
    .filter((d) => !d.endsWith('/project'))
  expect(trees.length).toBeGreaterThanOrEqual(1)
  const builderTree = trees[0]!
  // No file in the builder's worktree holds any held-out step text.
  expect(holds(builderTree, 'STEP-ONE-MARK')).toEqual([])
  expect(holds(builderTree, 'STEP-TWO-MARK')).toEqual([])

  const [code, stdout, stderr] = await done
  expect({ code, stderr }).toMatchObject({ code: 0 })
  expect(stdout).toContain('held-out: the step author wrote 2 step(s) for ticket 3')
  // The steps are Given/When/Then, from the ticket, and a binder turned them into tests.
  const stored = readFileSync(join(store(c), 'steps-3.json'), 'utf8')
  expect(stored).toContain('STEP-ONE-MARK')
  expect(c.p.agentRoles()).toContain('heldout-binder')
  expect(readFileSync(join(store(c), 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  // The person finds both outside the builder's worktree.
  expect(store(c).startsWith(builderTree)).toBe(false)
  // The builder's branch holds no step text, and no builder prompt does.
  const branch = /werk-build\/[\w-]+/.exec(stdout)![0]
  expect(c.p.run(['git', 'grep', '-q', 'STEP-', branch]).code).toBe(1)
  const prompts = c.promptsOf('builder')
  expect(prompts.length).toBeGreaterThan(0)
  for (const prompt of prompts) expect(prompt).not.toContain('STEP-')
}, 60_000)

/** A run that merged ticket 3 and bound its two steps, then a break on the main line that step 3.1 hits. */
function brokenRun(): Ctx {
  const c = setup(GREEN_CHECK, [ticketOf(3)], { 'feature.txt': 'works\n' })
  const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, ...reply({}).steps] }
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [builder], 'heldout-author': author, 'heldout-binder': bindTests } })
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(existsSync(join(store(c), 'tests', '3.1.sh'))).toBe(true)
  commitFeature(c, 'broken')
  return c
}

test('86.2 a held-out run on a broken tree reports the red step', () => {
  const c = brokenRun()
  const r = c.p.werk(['heldout', 'root'])
  expect(r.stdout).toContain('red 3.1')
  expect(r.stdout).toContain('green 3.2')
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  const c = brokenRun()
  expect(c.p.werk(['heldout', 'root']).code).toBe(1)
  // The next builder pass of the subtree: a new ticket of the same subtree.
  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  c.p.werk(['build', '4', '--cap', '1'])
  const prompt = c.promptsOf('builder').at(-1)!
  expect(prompt).toContain(STEP_SEARCH)
  expect(prompt).not.toContain('TEST-CODE-MARK')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('STEP-TWO-MARK')
}, 60_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const c = brokenRun()
  expect(c.p.werk(['heldout', 'root']).code).toBe(1)
  const before = c.gates()
  const r = c.p.werk(['gate', 'root'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toContain('3.1')
  expect(r.stdout).toContain('red')
  expect(c.gates()).toEqual(before)
  expect(c.gates()).not.toContain(c.git('rev-parse', 'main'))
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  const c = brokenRun()
  expect(c.p.werk(['heldout', 'root']).code).toBe(1)
  expect(c.p.werk(['gate', 'root']).code).toBe(1)
  // The builder fixed the break on the run's tree.
  commitFeature(c, 'works')
  const again = c.p.werk(['heldout', 'root'])
  expect(again.code).toBe(0)
  expect(again.stdout).toContain('green 3.1')
  expect(again.stdout).toContain('green 3.2')
  const gate = c.p.werk(['gate', 'root'])
  expect(gate.code).toBe(0)
  expect(gate.stdout).toContain('G2 is open for root')
  expect(c.gates().at(-1)).toBe(c.git('rev-parse', 'main'))
}, 60_000)
