/** Held-out group 86: the held-out set, its run, the builder feedback, and G2. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { binder, judges, reply, setup, ticketOf, type Ctx } from './s86-lib.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees MARK-STEP-ALPHA'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees MARK-STEP-BETA'
const TEST_CODE = 'grep -q works feature.txt # MARK-TEST-CODE\n'
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }] })
const bindAll = binder({ '3.1': 'sh .werk-heldout/3.1.sh', '3.2': 'true' }, [{ edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } }])
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, reply({}).steps[0]!] }

/** A project with feature.txt "works" on main and a green check; ticket 3 (and maybe 4) in ready. */
function project(tickets = [3]) {
  c = setup('check:\n\t@true\n', { 'feature.txt': 'works\n' }, tickets.map((n) => ticketOf(n)))
  return c
}
function commitFeature(text: string) {
  writeFileSync(join(c!.p.dir, 'feature.txt'), `${text}\n`)
  c!.p.run(['git', 'commit', '--quiet', '-am', `feature: ${text}`])
}
/** Build and merge ticket 3 through the merge loop, so its step author and binder run. */
function buildAndMerge3() {
  c!.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [builder], 'heldout-author': author, 'heldout-binder': bindAll } })
  const r = c!.p.werk(['run', 'root'])
  return r
}

test('86.1 the builder never sees the held-out steps', async () => {
  const { p, store, git, prompts } = project()
  const slowBuilder: FakeReply = { steps: [{ sleep: 4000 }, ...builder.steps] }
  const slowAuthor: FakeReply = { steps: [{ sleep: 1000 }, ...author.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowBuilder], 'heldout-author': slowAuthor, 'heldout-binder': bindAll } })

  const proc = Bun.spawn([process.execPath, MAIN, 'run', 'root'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  // The person looks at the builder's worktree while the builder works.
  let tree: string | undefined
  let authoredDuringBuild = false
  let worktreeHits: string[] = []
  const until = Date.now() + 15_000
  while (Date.now() < until && proc.exitCode === null) {
    tree ??= git('worktree', 'list', '--porcelain')
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice(9))
      .find((d) => d.includes('werk-build-'))
    const stillBuilding = tree !== undefined && existsSync(tree) && !existsSync(join(tree, 'work.txt'))
    if (stillBuilding && existsSync(join(store, 'steps-3.json'))) {
      authoredDuringBuild = true
      const g = p.run(['grep', '-rl', '-e', 'MARK-STEP', '-e', 'MARK-TEST', tree!])
      worktreeHits = g.stdout.split('\n').filter(Boolean)
      break
    }
    await Bun.sleep(100)
  }
  const code = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  const stdout = await new Response(proc.stdout).text()
  expect(stderr).toBe('')
  expect(code).toBe(0)

  // The step author started with the builder, and finished while the builder was still in pass 1.
  expect(p.agentRoles()).toContain('heldout-author')
  expect(authoredDuringBuild).toBe(true)
  expect(worktreeHits).toEqual([])
  const stored = JSON.parse(readFileSync(join(store, 'steps-3.json'), 'utf8'))
  expect(stored.steps.map((s: { text: string }) => s.text)).toEqual([STEP_A, STEP_B])

  // A binder turned the steps into tests; the person finds them in the store, outside the worktree.
  expect(p.agentRoles()).toContain('heldout-binder')
  expect(readFileSync(join(store, 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  expect(tree).toBeDefined()
  expect(store.startsWith(tree!)).toBe(false)

  // No file the builder's branch holds has any step text.
  const branch = /werk-build\/[\w-]+/.exec(stdout)![0]
  expect(p.run(['git', 'grep', '-q', 'MARK-STEP', branch]).code).toBe(1)
  // No prompt the builder receives holds any step text.
  const builderPrompts = prompts('builder')
  expect(builderPrompts.length).toBeGreaterThan(0)
  for (const pr of builderPrompts) {
    expect(pr).not.toContain('MARK-STEP')
    expect(pr).not.toContain('When the user opens the feature')
  }
  const builderArgv = p.agentLaunches().filter((_, i) => p.agentRoles()[i] === 'builder')
  for (const argv of builderArgv) expect(argv.join(' ')).not.toContain('MARK-STEP')
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  const { p } = project()
  expect(buildAndMerge3().code).toBe(0)
  // The run's tree has a break that the path of step 3.1 hits.
  commitFeature('broken')
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toContain(`red 3.1\n${STEP_A.replace(/^/gm, '    ')}`)
  expect(r.stdout).toContain('green 3.2')
  expect(r.stdout).not.toContain('red 3.2')
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  const { p, prompts } = project([3, 4])
  // Ticket 4 waits on a blocker so the first run merges only ticket 3.
  c!.appendBoard({ type: 'ticket.planned', payload: ticketOf(4, { blockedBy: [99] }) })
  expect(buildAndMerge3().code).toBe(1)
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)

  // The next builder pass on a ticket of the run.
  c!.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  const before = prompts('builder').length
  p.werk(['build', '4', '--cap', '1'])
  const after = prompts('builder')
  expect(after.length).toBe(before + 1)
  const prompt = after.at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('MARK-TEST-CODE')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('MARK-STEP-BETA')
  expect(prompt).not.toContain('When the user saves a file')
}, 60_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const { p, events } = project()
  expect(buildAndMerge3().code).toBe(0)
  const gatesBefore = events().filter((e) => e.type === 'gate.opened').length
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)

  const g = p.werk(['gate', 'root'])
  expect(g.code).not.toBe(0)
  expect(g.stdout).toContain('step 3.1 is red')
  expect(g.stdout).toContain('G2 stays closed')
  const tip = c!.git('rev-parse', 'main')
  expect(events().filter((e) => e.type === 'gate.opened' && e.payload.commit === tip)).toHaveLength(0)
  expect(events().filter((e) => e.type === 'gate.opened')).toHaveLength(gatesBefore)
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  const { p, events } = project()
  expect(buildAndMerge3().code).toBe(0)
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  expect(p.werk(['gate', 'root']).code).toBe(1)

  // The builder fixed the break on the run's tree.
  commitFeature('works')
  const h = p.werk(['heldout', 'root'])
  expect(h.code).toBe(0)
  expect(h.stdout).toContain('every held-out step is green')
  const g = p.werk(['gate', 'root'])
  expect(g.stderr).toBe('')
  expect(g.code).toBe(0)
  const tip = c!.git('rev-parse', 'main')
  expect(g.stdout).toContain(`G2 is open for root at ${tip.slice(0, 12)}`)
  expect(events().at(-1)).toMatchObject({ type: 'gate.opened', payload: { gate: 'G2', root: 'root', commit: tip } })
  expect(readdirSync(join(c!.store, 'runs')).length).toBeGreaterThan(0)
}, 60_000)
