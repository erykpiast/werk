import { afterEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { appendBoard, binder, events, git, prompts, reply, setup, ticketOf } from './common.ts'

const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')
let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HELDOUT-A-MARK'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees HELDOUT-B-MARK'
const STEP_C = 'Given the product is installed\nWhen the user closes the app\nThen the user sees HELDOUT-C-MARK'
const TEST_CODE = 'grep -q works feature.txt # BOUND-TEST-MARK\n'
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }, { text: STEP_C }] })
const bindAll = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...binder({ '3.1': 'sh .werk-heldout/3.1.sh', '3.2': 'true', '3.3': 'true' }).steps,
  ],
}
const RED_MAKE = 'check:\n\t@echo the check is red; exit 1\n'

function commitFeature(text: string) {
  writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}

/** A built (one red pass) and done ticket 3 with stored steps. */
function builtAndDone(extraTickets: number[] = []) {
  p = setup(RED_MAKE, { 'feature.txt': 'works\n' }, [ticketOf(3), ...extraTickets.map((n) => ticketOf(n))])
  p.scriptAgent({ steps: [], roles: { builder: { steps: [{ edit: { path: 'w.txt', content: 'x\n' } }, ...reply({}).steps] }, 'heldout-author': author, 'heldout-binder': bindAll } })
  const r = p.werk(['build', '3', '--cap', '1'])
  appendBoard(p, { type: 'ticket.moved', payload: { number: 3, to: 'done' } })
  return r
}

const grepTree = (dir: string, mark: string): string[] => {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== '.git') walk(full) }
      else if (readFileSync(full, 'utf8').includes(mark)) hits.push(full)
    }
  }
  walk(dir)
  return hits
}

test('86.1 the builder never sees the held-out steps', async () => {
  p = setup(RED_MAKE, { 'feature.txt': 'works\n' }, [ticketOf(3)])
  const flag = join(p.dir, '..', 'go')
  p.scriptAgent({
    steps: [],
    roles: {
      builder: { steps: [{ waitFor: flag }, { edit: { path: 'w.txt', content: 'x\n' } }, ...reply({}).steps] },
      'heldout-author': author,
      'heldout-binder': bindAll,
    },
  })
  const child = Bun.spawn([process.execPath, MAIN, 'build', '3', '--cap', '1'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  // While the builder works: find its worktree.
  let tree: string | undefined
  for (let i = 0; i < 200 && tree === undefined; i++) {
    await Bun.sleep(100)
    const list = git(p, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))
    tree = list.find((d) => d.includes('werk-build-'))
  }
  expect(tree).toBeDefined()
  // The step author runs while the builder works.
  let stepsFile: string | undefined
  for (let i = 0; i < 100 && stepsFile === undefined; i++) {
    const f = join(p.dir, '.werk', 'heldout', 'root', 'steps-3.json')
    if (existsSync(f)) stepsFile = f
    else await Bun.sleep(100)
  }
  expect(stepsFile).toBeDefined()
  expect(p.agentRoles()).toContain('heldout-author')
  for (const mark of ['HELDOUT-A-MARK', 'HELDOUT-B-MARK', 'HELDOUT-C-MARK']) expect(grepTree(tree!, mark)).toEqual([])
  writeFileSync(flag, '')
  await child.exited
  appendBoard(p, { type: 'ticket.moved', payload: { number: 3, to: 'done' } })
  // A binder turns the steps into tests.
  const r = p.werk(['heldout', 'root'])
  expect(prompts(p, 'heldout-binder')[0]).toContain(STEP_A)
  const store = join(p.dir, '.werk', 'heldout', 'root')
  expect(readFileSync(join(store, 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  expect(r.code).toBe(0)
  // The store is outside every builder worktree: git ignores it.
  expect(p.run(['git', 'check-ignore', '-q', '.werk/heldout/root/steps-3.json']).code).toBe(0)
  for (const prompt of prompts(p, 'builder')) {
    expect(prompt).not.toContain('HELDOUT-A-MARK')
    expect(prompt).not.toContain('HELDOUT-B-MARK')
    expect(prompt).not.toContain('HELDOUT-C-MARK')
  }
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  builtAndDone()
  commitFeature('broken')
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toContain('red 3.1')
  expect(r.stdout).toContain('green 3.2')
  expect(r.stdout).toContain('green 3.3')
  expect(r.code).not.toBe(0)
}, 30_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  builtAndDone([4])
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  p.werk(['build', '4', '--cap', '1'])
  const prompt = prompts(p, 'builder').at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('BOUND-TEST-MARK')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('HELDOUT-B-MARK')
  expect(prompt).not.toContain('HELDOUT-C-MARK')
}, 30_000)

test('86.4 and 86.5 the gate refuses G2 while a step is red, and opens after it turns green', () => {
  builtAndDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  const refused = p.werk(['gate', 'root'])
  expect(refused.code).not.toBe(0)
  expect(refused.stdout + refused.stderr).toContain('3.1')
  expect(events(p).some((e) => e.type === 'gate.opened')).toBe(false)
  console.log('86.4 OK')

  commitFeature('works')
  const again = p.werk(['heldout', 'root'])
  expect(again.code).toBe(0)
  expect(again.stdout).toContain('every held-out step is green')
  const open = p.werk(['gate', 'root'])
  expect(open.code).toBe(0)
  expect(open.stdout).toContain('G2 is open for root')
  expect(events(p).filter((e) => e.type === 'gate.opened').at(-1)).toMatchObject({ payload: { gate: 'G2', root: 'root', commit: git(p, 'rev-parse', 'main') } })
  console.log('86.5 OK')
}, 60_000)
