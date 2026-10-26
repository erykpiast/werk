/** Held-out steps 86.1–86.5: the step author, the binder, the held-out run and the gate G2. */
import { expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const STEP_RED = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HELDOUT-ALPHA'
const STEP_GREEN = 'Given the product is installed\nWhen the user saves a file\nThen the user sees HELDOUT-BETA'
const TEST_CODE = 'grep -q works feature.txt # BOUND-TEST-CODE\n'

const ticket: TicketFields = {
  number: 3,
  title: 'Ticket 3',
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: ['module 3'],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
}

const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const author = reply({ steps: [{ text: STEP_RED }, { text: STEP_GREEN }] })
const builder: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, ...reply({}).steps] }
const binder: FakeReply = {
  steps: [
    { edit: { path: '.werk-heldout/3.1.sh', content: TEST_CODE } },
    ...reply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps,
  ],
}

function setup() {
  const p = makeProject()
  const werk = join(p.dir, '.werk')
  const board = join(werk, 'board.jsonl')
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@echo the check is red; exit 1\n')
  p.run(['git', 'add', 'Makefile'])
  const feature = (text: string) => {
    writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
    p.run(['git', 'add', 'feature.txt'])
    p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
  }
  feature('works')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board, '')
  const append = (...events: NewBoardEvent[]) => {
    for (const e of events) appendFileSync(board, JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
  }
  append({ type: 'ticket.planned', payload: ticket })
  p.scriptAgent({ steps: [], roles: { builder: [builder], 'heldout-author': author, 'heldout-binder': binder } })
  const prompts = (role: string) => {
    const roles = p.agentRoles()
    return p.agentInputs().flatMap((lines, i) => {
      const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
      if (roles[i] !== role) return []
      return [user?.message.content ?? (p.agentLaunches()[i] ?? []).join(' ')]
    })
  }
  /** Builds ticket 3 for one pass (its check is red), then the ticket is marked done on the board. */
  const buildDone = () => {
    const r = p.werk(['build', '3', '--cap', '1'])
    append({ type: 'ticket.moved', payload: { number: 3, to: 'done' } })
    return r
  }
  const boardLog = () => readLog<BoardEvent>(board)
  return { p, werk, board, feature, append, prompts, buildDone, boardLog }
}

test('86.1 the builder never sees the held-out steps', () => {
  const { p, werk, prompts, buildDone } = setup()
  const r = buildDone()
  const roles = p.agentRoles()
  // The step author starts in the same build as the builder.
  expect(roles).toContain('heldout-author')
  expect(roles).toContain('builder')
  expect(roles.filter((x) => x === 'heldout-author')).toHaveLength(1)

  expect(p.werk(['heldout', 'root']).code).toBe(0)
  expect(roles.concat(p.agentRoles())).toContain('heldout-binder')

  // The steps and the tests sit in the store under .werk/heldout, outside the builder's worktree.
  const store = join(werk, 'heldout', 'root')
  const all = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]))
  const storeText = all(store).map((f) => readFileSync(f, 'utf8')).join('\n')
  expect(storeText).toContain('HELDOUT-ALPHA')
  expect(storeText).toContain('BOUND-TEST-CODE')

  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(p.run(['git', 'grep', '-q', 'HELDOUT-', branch]).code).toBe(1)
  const worktrees = p.run(['git', 'worktree', 'list', '--porcelain']).stdout
  for (const wt of worktrees.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))) {
    if (!existsSync(wt) || realpathSync(wt) === realpathSync(p.dir)) continue
    expect(p.run(['grep', '-rq', 'HELDOUT-', wt]).code).not.toBe(0)
  }
  for (const prompt of prompts('builder')) expect(prompt).not.toContain('HELDOUT-')
}, 30_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  const { p, feature, buildDone } = setup()
  buildDone()
  feature('broken')
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toMatch(/red 3\.1/)
  expect(r.stdout).toMatch(/green 3\.2/)
  expect(r.code).not.toBe(0)
}, 30_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  const { p, feature, append, prompts, buildDone } = setup()
  buildDone()
  feature('broken')
  expect(p.werk(['heldout', 'root']).code).not.toBe(0)
  append({ type: 'ticket.moved', payload: { number: 3, to: 'ready' } })
  p.werk(['build', '3', '--cap', '1'])
  const prompt = prompts('builder').at(-1)!
  expect(prompt).toContain(STEP_RED)
  expect(prompt).not.toContain('BOUND-TEST-CODE')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('HELDOUT-BETA')
}, 40_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  const { p, feature, buildDone, boardLog } = setup()
  buildDone()
  feature('broken')
  p.werk(['heldout', 'root'])
  const r = p.werk(['gate', 'root'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/3\.1/)
  expect(boardLog().filter((e) => e.type === 'gate.opened')).toHaveLength(0)
}, 30_000)

test('86.5 G2 opens after the red step turns green', () => {
  const { p, feature, buildDone, boardLog } = setup()
  buildDone()
  feature('broken')
  p.werk(['heldout', 'root'])
  expect(p.werk(['gate', 'root']).code).not.toBe(0)
  feature('works')
  const again = p.werk(['heldout', 'root'])
  expect(again.stdout).toContain('every held-out step is green')
  expect(again.code).toBe(0)
  const gate = p.werk(['gate', 'root'])
  expect(gate.code).toBe(0)
  const tip = p.run(['git', 'rev-parse', 'main']).stdout.trim()
  expect(boardLog().filter((e) => e.type === 'gate.opened')).toMatchObject([{ payload: { gate: 'G2', root: 'root', commit: tip } }])
}, 40_000)
