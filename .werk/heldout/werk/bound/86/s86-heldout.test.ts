import { afterEach, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, TicketFields } from '../src/board/events.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import type { Project } from '../src/test/harness.ts'
import { accepted, proposed } from '../src/test/map-events.ts'
import { appendBoard, branchOf, judgeReply, makeBuildProject, prompts } from './build-kit.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const STEP_OPEN = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HELDOUT-STEP-ONE'
const STEP_SAVE = 'Given the product is installed\nWhen the user saves a file\nThen the user sees HELDOUT-STEP-TWO'
const TEST_CODE = 'grep -q works feature.txt # HELDOUT-TEST-CODE\n'

const ticketOf = (number: number): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The user sees that the feature works.',
  root: 'root',
})
const author = judgeReply({ steps: [{ text: STEP_OPEN }, { text: STEP_SAVE }] })
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, judgeReply({}).steps[0]!] }
const binder: FakeReply = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...judgeReply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps,
  ],
}
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const board = () => join(p.dir, '.werk', 'board.jsonl')
const store = () => join(p.dir, '.werk', 'heldout', 'root')

function commitFeature(text: string) {
  writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}

/** A project whose check is red (no done.txt), so one build pass is enough to start the author. */
function setup(extra: number[] = []) {
  p = makeBuildProject(ticketOf(3), [proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop')])
  for (const n of extra) appendBoard(p, { type: 'ticket.planned', payload: ticketOf(n) })
  commitFeature('works')
  p.scriptAgent({ steps: [], roles: { builder: [builder], 'heldout-author': author, 'heldout-binder': binder } })
}

/** Builds ticket 3 and marks it done: v0 has no merge verb, so the board event stands for the merge. */
function buildAndDone(n = 3) {
  const r = p.werk(['build', String(n), '--cap', '1'])
  appendBoard(p, { type: 'ticket.moved', payload: { number: n, to: 'done' } })
  return r
}

const allFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)]))

test('86.1 The builder never sees the held-out steps', () => {
  setup()
  const r = buildAndDone()
  const roles = p.agentRoles()
  expect(roles).toContain('builder')
  expect(roles).toContain('heldout-author')
  expect(prompts(p, 'heldout-author')[0]).toContain('The user sees that the feature works.')
  // The steps live outside the builder's worktree.
  const stored = readFileSync(join(store(), 'steps-3.json'), 'utf8')
  expect(stored).toContain('HELDOUT-STEP-ONE')
  // The binder turns the steps into tests, in the held-out run.
  p.werk(['heldout', 'root'])
  expect(roles.concat(p.agentRoles())).toContain('heldout-binder')
  expect(readFileSync(join(store(), 'tests', '3.1.sh'), 'utf8')).toBe(TEST_CODE)
  // The builder's worktree: its branch holds no step text and no test.
  const branch = branchOf(r.stdout)!
  expect(p.run(['git', 'grep', '-q', 'HELDOUT-', branch]).code).toBe(1)
  expect(p.run(['git', 'check-ignore', '-q', '.werk/heldout/root/steps-3.json']).code).toBe(0)
  for (const prompt of prompts(p, 'builder')) {
    expect(prompt).not.toContain('HELDOUT-STEP')
    expect(prompt).not.toContain('When the user opens the feature')
  }
}, 40_000)

test('86.2 A held-out run on a broken tree reports the red step', () => {
  setup()
  buildAndDone()
  expect(p.werk(['heldout', 'root']).code).toBe(0)
  commitFeature('broken')
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toMatch(/red 3\.1/)
  expect(r.stdout).toContain('green 3.2')
  expect(r.stdout).not.toMatch(/red 3\.2/)
  expect(r.code).not.toBe(0)
}, 40_000)

test('86.3 The builder gets the failed step text, not the test', () => {
  setup([4])
  buildAndDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  // The next pass of a builder in the same run (the subtree's next ready ticket).
  p.werk(['build', '4', '--cap', '1'])
  const prompt = prompts(p, 'builder').at(-1)!
  expect(prompt).toContain(STEP_OPEN)
  expect(prompt).not.toContain('HELDOUT-TEST-CODE')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('HELDOUT-STEP-TWO')
  expect(prompt).not.toContain('When the user saves a file')
}, 40_000)

const gateOpened = () => readLog<BoardEvent>(board()).filter((e) => e.type === 'gate.opened')

test('86.4 The gate refuses G2 while a held-out step is red', () => {
  setup()
  buildAndDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  const r = p.werk(['gate', 'root'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('3.1')
  expect(r.stdout + r.stderr).toMatch(/3\.1 is red/)
  expect(gateOpened()).toHaveLength(0)
}, 40_000)

test('86.5 G2 opens after the red step turns green', () => {
  setup()
  buildAndDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  expect(p.werk(['gate', 'root']).code).toBe(1)
  commitFeature('works')
  const run = p.werk(['heldout', 'root'])
  expect(run.stdout).toContain('every held-out step is green')
  const r = p.werk(['gate', 'root'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('G2 is open for root')
  expect(gateOpened()).toHaveLength(1)
  expect(gateOpened()[0]!.payload).toMatchObject({ gate: 'G2', root: 'root', commit: git('rev-parse', 'main') })
}, 60_000)
