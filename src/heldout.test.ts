import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorSteps, BINDER_MS_PER_STEP, binderTimeoutMs, runHeldout, stepsFile } from './heldout.ts'
import type { Step } from './heldout.ts'
import { fakeClaude, git, makeRepo } from './testing/fixture.ts'
import type { FakeRule } from './testing/fake-claude.ts'
import type { ParsedTicket } from './ticket.ts'

const PATH = process.env.PATH
let sessionDir: string

function use(rules: FakeRule[]) {
  const fake = fakeClaude(rules)
  process.env.PATH = `${fake.bin}:${PATH}`
  process.env.FAKE_CLAUDE_SCRIPT = fake.script
  return fake
}

afterAll(() => {
  process.env.PATH = PATH
  delete process.env.FAKE_CLAUDE_SCRIPT
})

beforeEach(() => {
  sessionDir = mkdtempSync(join(tmpdir(), 'werk-heldout-sessions-'))
})

const TICKET: ParsedTicket = { file: '01.md', num: 1, title: 'List', cites: ['kid'], blockedBy: [], stories: [1], touches: ['list'], whatToBuild: 'List, end to end.', acceptance: ['It works'], checks: [], namesFiles: false }
const LIMITS = { timeoutMs: 20_000, silenceMs: 5000 }
const STEPS: Step[] = [
  { id: '01.1', ticket: 'r1/01', text: 'Scenario: one\nGiven a\nWhen b\nThen c' },
  { id: '01.2', ticket: 'r1/01', text: 'Scenario: two\nGiven d\nWhen e\nThen f' },
]

/** A repository with a main line to bind against. */
function runRepo() {
  return makeRepo({ 'app.txt': 'the app\n' })
}

describe('the step author (#lp-heldout-author)', () => {
  test('an answer with no scenario writes no file and reports an error', async () => {
    const repo = makeRepo()
    const fake = use([{ match: 'You are the step author', result: 'I would test that the list works.' }])
    const out = await authorSteps(repo, { ...LIMITS, run: 'r1', ticketId: 'r1/01', sessionDir, brief: { ticket: TICKET, stories: [], cards: [] } })
    expect(out).toEqual({ count: 0, error: 'the step author wrote no Given/When/Then scenario', costUsd: 0.01 })
    expect(existsSync(stepsFile(repo, 'r1', 'r1/01'))).toBe(false)
    expect(fake.calls()).toHaveLength(1)
  })
})

describe('the binder (#lp-heldout-binder)', () => {
  test('a copy of the bound tests is kept for a person, and never reaches the main line', async () => {
    const repo = runRepo()
    const tip = git(repo, 'rev-parse', 'main')
    use([
      {
        match: 'You are the binder',
        files: { '.werk-heldout/list.test.ts': 'test code\n', '.werk-heldout/deep/kept.test.ts': 'more test code\n' },
        result: JSON.stringify([
          { id: '01.1', result: 'pass', detail: 'ok' },
          { id: '01.2', result: 'fail', detail: 'gone' },
        ]),
      },
    ])
    const out = await runHeldout(repo, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01' })
    expect(out.verdicts.map((v) => v.result)).toEqual(['pass', 'fail'])
    expect(out.bound).toBe(join(repo, '.werk', 'heldout', 'r1', 'bound', 'after-01'))
    expect(readFileSync(join(out.bound!, 'list.test.ts'), 'utf8')).toBe('test code\n')
    expect(readFileSync(join(out.bound!, 'deep', 'kept.test.ts'), 'utf8')).toBe('more test code\n')
    expect(git(repo, 'rev-parse', 'main')).toBe(tip)
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('.werk-heldout')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  test('test output under the test directory with a name git quotes is not a change to the product', async () => {
    const repo = runRepo()
    use([{ match: 'You are the binder', files: { '.werk-heldout/test-results/69-72 a person ✓/trace.zip': 'zip\n' }, result: '[{"id": "01.1", "result": "pass"}, {"id": "01.2", "result": "pass"}]' }])
    const out = await runHeldout(repo, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01' })
    expect(out.verdicts.map((v) => v.result)).toEqual(['pass', 'pass'])
  })

  test('a binder that changes a product file voids its whole report', async () => {
    const repo = runRepo()
    use([{ match: 'You are the binder', files: { 'app.txt': 'fitted\n' }, result: '[{"id": "01.1", "result": "pass"}, {"id": "01.2", "result": "pass"}]' }])
    const out = await runHeldout(repo, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01' })
    expect(out.verdicts.every((v) => v.result === 'binder-error' && v.detail === 'the binder changed files outside .werk-heldout/: app.txt')).toBe(true)
  })

  test('a binder that wrote no test leaves no copy', async () => {
    const repo = runRepo()
    use([{ match: 'You are the binder', result: '[{"id": "01.1", "result": "pass"}, {"id": "01.2", "result": "pass"}]' }])
    const out = await runHeldout(repo, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01' })
    expect(out.bound).toBeUndefined()
    expect(existsSync(join(repo, '.werk', 'heldout', 'r1', 'bound'))).toBe(false)
  })

  test('a failed binder session marks every step a binder error, never a pass', async () => {
    const repo = runRepo()
    use([
      {
        match: 'You are the binder',
        files: { '.werk-heldout/half.test.ts': 'half\n' },
        // Its last words claim a pass; the session failed, so they count for nothing.
        result: '[{"id": "01.1", "result": "pass"}, {"id": "01.2", "result": "pass"}]',
        exitCode: 1,
        stderr: 'binder crashed',
      },
    ])
    const out = await runHeldout(repo, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01' })
    expect(out.error).toBe('binder crashed')
    expect(out.verdicts).toEqual([
      { id: '01.1', result: 'binder-error', detail: 'the binder session failed: binder crashed' },
      { id: '01.2', result: 'binder-error', detail: 'the binder session failed: binder crashed' },
    ])
    // What it wrote before it failed is still kept for a person.
    expect(readdirSync(out.bound!)).toEqual(['half.test.ts'])
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  test('in a target repository the binder runs on its main line, and the bound copy stays with the map (#st-build-target)', async () => {
    const map = runRepo()
    // The map's own repository has no main line: a bind there would be a binder error.
    git(map, 'branch', '-m', 'main', 'trunk')
    const target = runRepo()
    use([{ match: 'You are the binder', files: { '.werk-heldout/t.test.ts': 'test\n' }, result: '[{"id": "01.1", "result": "pass"}, {"id": "01.2", "result": "pass"}]' }])
    const out = await runHeldout(map, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01', repo: target })
    expect(out.verdicts.map((v) => v.result)).toEqual(['pass', 'pass'])
    expect(out.bound).toBe(join(map, '.werk', 'heldout', 'r1', 'bound', 'after-01'))
    expect(git(target, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  test('the time limit grows with the steps: the configured limit or a per-step allowance, the larger (#st-heldout-notrun)', () => {
    expect(BINDER_MS_PER_STEP).toBe(120_000)
    expect(binderTimeoutMs(600_000, 2)).toBe(600_000)
    expect(binderTimeoutMs(600_000, 10)).toBe(10 * BINDER_MS_PER_STEP)
    expect(binderTimeoutMs(20_000, 0)).toBe(20_000)
  })

  test('with no main line every step is a binder error, and no binder runs', async () => {
    const repo = runRepo()
    git(repo, 'branch', '-m', 'main', 'trunk')
    const fake = use([{ match: 'You are the binder', result: '[]' }])
    const out = await runHeldout(repo, { ...LIMITS, run: 'r1', steps: STEPS, sessionDir, label: 'after-01' })
    expect(out.verdicts.map((v) => [v.result, v.detail])).toEqual([
      ['binder-error', 'no main line branch main'],
      ['binder-error', 'no main line branch main'],
    ])
    expect(fake.calls()).toHaveLength(0)
  })
})
