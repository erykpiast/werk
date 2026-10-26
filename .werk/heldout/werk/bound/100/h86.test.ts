/** Held-out steps 86.1–86.5: the held-out set, the binder, and the G2 gate. */
import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

const STEP_A = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HOSTEPA'
const STEP_B = 'Given the product is installed\nWhen the user saves a file\nThen the user sees HOSTEPB'
const TEST_CODE = 'grep -q works feature.txt # HOTESTCODE\n'

const ticketOf = (number: number): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.\n- The feature saves.',
  root: 'root',
})

const werkDir = () => join(p.dir, '.werk')
const board = () => join(werkDir(), 'board.jsonl')
const store = () => join(werkDir(), 'heldout', 'root')
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const appendBoard = (...events: NewBoardEvent[]) => {
  for (const e of events) appendFileSync(board(), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}
function commitFeature(text: string) {
  writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}
function project(tickets: number[] = [3]) {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@echo the check is red; exit 1\n')
  p.run(['git', 'add', 'Makefile'])
  commitFeature('works')
  mkdirSync(join(werkDir(), 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werkDir(), 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board(), '')
  appendBoard(...tickets.map((n): NewBoardEvent => ({ type: 'ticket.planned', payload: ticketOf(n) })))
}
const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const author = reply({ steps: [{ text: STEP_A }, { text: STEP_B }] })
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, ...reply({}).steps] }
const binder: FakeReply = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...reply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps,
  ],
}
const scriptAll = () => p.scriptAgent({ steps: [], roles: { builder: [builder], 'heldout-author': author, 'heldout-binder': binder } })
const prompts = (role: string) => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => {
    const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
    return roles[i] === role && user ? [user.message.content] : []
  })
}
const allPromptText = (role: string) => {
  const roles = p.agentRoles()
  const argv = p.agentLaunches()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [JSON.stringify(lines) + JSON.stringify(argv[i])] : []))
}
/** Builds ticket 3 for one pass, so its step author runs, then marks it done the way a merge does. */
function buildAndMarkDone(n = 3) {
  const r = p.werk(['build', String(n), '--cap', '1'])
  appendBoard({ type: 'ticket.moved', payload: { number: n, to: 'done' } })
  return r
}
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === '.git' ? [] : e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)],
  )

// 86.1 Scenario: The builder never sees the held-out steps
// Given a planned ticket with acceptance criteria on the board
// And a person starts the build of that ticket
// When the builder starts work on the ticket
// Then a step author starts at the same time and writes Given, When, Then steps from the ticket
// And a binder turns those steps into tests
// And the person finds the steps and the tests outside the builder's worktree
// But no file in the builder's worktree holds any held-out step text
// And no prompt the builder receives holds any held-out step text
test('86.1 the builder never sees the held-out steps', () => {
  project()
  scriptAll()
  const r = buildAndMarkDone()
  expect(p.agentRoles()).toContain('builder')
  expect(p.agentRoles()).toContain('heldout-author')
  expect(r.stdout).toContain('step author wrote 2 step(s) for ticket 3')
  const stored = JSON.parse(readFileSync(join(store(), 'steps-3.json'), 'utf8'))
  expect(stored.steps.map((s: { text: string }) => s.text)).toEqual([STEP_A, STEP_B])

  const h = p.werk(['heldout', 'root'])
  expect(p.agentRoles()).toContain('heldout-binder')
  expect(existsSync(join(store(), 'tests', '3.1.sh'))).toBe(true)
  expect(h.code).toBe(0)

  // The builder's worktree is its branch: no committed file of it holds step text.
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(p.run(['git', 'grep', '-q', 'HOSTEP', branch]).code).toBe(1)
  // Any worktree that still exists holds no step text either.
  const worktrees = git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))
  for (const wt of worktrees.filter((w) => existsSync(w) && realpathSync(w) !== realpathSync(p.dir))) {
    for (const f of filesUnder(wt)) expect(readFileSync(f, 'utf8')).not.toContain('HOSTEP')
  }
  expect(prompts('builder').length).toBeGreaterThan(0)
  for (const text of allPromptText('builder')) expect(text).not.toContain('HOSTEP')
}, 60_000)

// 86.2 Scenario: A held-out run on a broken tree reports the red step
test('86.2 a held-out run on a broken tree reports the red step', () => {
  project()
  scriptAll()
  buildAndMarkDone()
  commitFeature('broken')
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toMatch(/red 3\.1/)
  expect(r.stdout).toMatch(/green 3\.2/)
  expect(r.code).not.toBe(0)
}, 60_000)

// 86.3 Scenario: The builder gets the failed step's text, not the test
test("86.3 the builder gets the failed step's text, not the test", () => {
  project([3, 4])
  scriptAll()
  buildAndMarkDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).stdout).toMatch(/red 3\.1/)
  const before = prompts('builder').length
  p.werk(['build', '4', '--cap', '1'])
  const all = prompts('builder')
  expect(all.length).toBe(before + 1)
  const prompt = all.at(-1)!
  expect(prompt).toContain(STEP_A)
  expect(prompt).not.toContain('HOTESTCODE')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('HOSTEPB')
}, 60_000)

// 86.4 Scenario: The gate refuses G2 while a held-out step is red
test('86.4 the gate refuses G2 while a held-out step is red', () => {
  project()
  scriptAll()
  buildAndMarkDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  const g = p.werk(['gate', 'root'])
  expect(g.code).not.toBe(0)
  expect(g.stdout + g.stderr).toContain('3.1')
  expect(g.stdout + g.stderr).toMatch(/red/)
  expect(readLog<BoardEvent>(board()).some((e) => e.type === 'gate.opened')).toBe(false)
}, 60_000)

// 86.5 Scenario: G2 opens after the red step turns green
test('86.5 G2 opens after the red step turns green', () => {
  project()
  scriptAll()
  buildAndMarkDone()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  expect(p.werk(['gate', 'root']).code).not.toBe(0)
  // The builder fixed the break on the run's tree.
  commitFeature('works')
  const h = p.werk(['heldout', 'root'])
  expect(h.stdout).toContain('every held-out step is green')
  expect(h.code).toBe(0)
  const g = p.werk(['gate', 'root'])
  expect(g.code).toBe(0)
  expect(g.stdout).toContain('G2 is open for root')
  expect(readLog<BoardEvent>(board()).filter((e) => e.type === 'gate.opened').at(-1)).toMatchObject({
    payload: { gate: 'G2', root: 'root', commit: git('rev-parse', 'main') },
  })
}, 60_000)
