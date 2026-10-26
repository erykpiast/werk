import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyAsk, classifyProgress } from './overseer.ts'
import { fakeClaude } from './testing/fixture.ts'
import type { FakeRule } from './testing/fake-claude.ts'

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
  sessionDir = mkdtempSync(join(tmpdir(), 'werk-overseer-'))
})

const progress = (timeoutMs = 10_000) => classifyProgress({ timeoutMs, sessionDir, brief: 'Build the list.', calls: ['Bash {"command":"make test"}'], name: 'progress-1-1' })

describe('the progress classifier (#lp-overseer-progress)', () => {
  test('an answer with no verdict counts as not looping', async () => {
    use([{ match: 'You are the progress classifier', result: 'Hard to say.' }])
    expect(await progress()).toEqual({ looping: false, reason: 'no verdict: no JSON object in the answer', costUsd: 0.01 })
  })

  test('a JSON answer with no "looping" counts as not looping', async () => {
    use([{ match: 'You are the progress classifier', result: 'Here: {"reason": "it repeats"}' }])
    expect(await progress()).toMatchObject({ looping: false, reason: 'no verdict: no "looping" in the answer' })
  })

  test('a failed classifier counts as not looping', async () => {
    use([{ exitCode: 1, stderr: 'classifier crashed' }])
    expect(await progress()).toMatchObject({ looping: false, reason: 'no verdict: classifier crashed' })
  })

  test('a classifier that times out counts as not looping', async () => {
    const fake = use([{ hangMs: 5000, result: '{"looping": true, "reason": "too late"}' }])
    const start = Date.now()
    const v = await progress(300)
    expect(Date.now() - start).toBeLessThan(3000)
    expect(v.looping).toBe(false)
    expect(v.reason).toBe('no verdict: killed after 300ms wall-clock cap')
    // No launch record is read here: under load the cap can end the run before the fake has
    // started, and the cap is the behaviour under test. The arguments have their own test.
    expect(fake.calls().length).toBeLessThanOrEqual(1)
  })

  test('the classifier runs with no tools', async () => {
    const fake = use([{ match: 'You are the progress classifier', result: '{"looping": false, "reason": "ok"}' }])
    await progress()
    expect(fake.calls()[0].argv.slice(-2)).toEqual(['--tools', ''])
  })
})

describe('the permission classifier (#lp-overseer-asks)', () => {
  test('an answer with no readable verdict denies the call, with a comment', async () => {
    use([{ match: 'You are the permission classifier', times: 1, result: 'Looks fine, I guess.' }, { match: 'You are the permission classifier', result: '{"comment": "fine"}' }])
    const ask = () => classifyAsk({ timeoutMs: 10_000, sessionDir, brief: 'Build the list.', tool: 'Bash', input: { command: 'ls' }, name: 'ask-1' })
    expect(await ask()).toEqual({ allow: false, comment: 'The overseer could not judge this call (no JSON object in the answer), so it is denied. Continue without it.', costUsd: 0.01 })
    expect(await ask()).toEqual({ allow: false, comment: 'The overseer could not judge this call (no "allow" in the answer), so it is denied. Continue without it.', costUsd: 0.01 })
  })

  test('a classifier that times out denies the call, and says why', async () => {
    use([{ hangMs: 5000, result: '{"allow": true, "comment": "too late"}' }])
    const start = Date.now()
    const v = await classifyAsk({ timeoutMs: 300, sessionDir, brief: 'Build the list.', tool: 'Bash', input: { command: 'ls' }, name: 'ask-1' })
    expect(Date.now() - start).toBeLessThan(3000)
    expect(v.allow).toBe(false)
    expect(v.comment).toBe('The overseer could not judge this call (killed after 300ms wall-clock cap), so it is denied. Continue without it.')
  })
})
