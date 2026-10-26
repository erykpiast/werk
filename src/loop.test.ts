import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fakeClaude, git, makeRepo, readJsonl, runCli } from './testing/fixture.ts'

// #st-build-seam: the loop is tested at its command line, with a scripted fake agent.
describe('werk loop', () => {
  test('runs fresh passes until the checks are green, one commit per pass', async () => {
    const repo = makeRepo()
    const fake = fakeClaude([
      { match: 'You are pass 1 of', result: 'did nothing yet' },
      { match: 'You are pass 2 of', files: { 'done.txt': 'ok\n' } },
    ])
    const r = await runCli(repo, fake, ['loop', 'make done.txt', '--check', 'test -f done.txt', '--cap', '3', '--run', 'L1'])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.green).toBe(true)
    expect(out.passes).toBe(2)
    expect(git(repo, 'log', '--format=%s', 'werk-loop/L1').split('\n').slice(0, 2)).toEqual(['werk loop L1: pass 2', 'werk loop L1: pass 1'])
    expect(git(repo, 'show', 'werk-loop/L1:done.txt')).toBe('ok')
    const records = readJsonl(join(repo, '.werk', 'runs', 'L1.jsonl'))
    expect(records.map((x) => x.green)).toEqual([false, true])
    // The second pass is told what failed, and nothing else carries over.
    const prompts = fake.calls().map((c) => c.prompt)
    expect(prompts[1]).toContain('Command: `test -f done.txt`')
    // Each session's event stream is kept, one event per line.
    const events = readJsonl(join(repo, '.werk', 'runs', 'L1', 'pass-1.jsonl'))
    expect(events.at(-1).type).toBe('result')
  })

  test('stops at the cap and keeps the branch', async () => {
    const repo = makeRepo()
    const fake = fakeClaude([{ result: 'no luck' }])
    const r = await runCli(repo, fake, ['loop', 'never', '--check', 'false', '--cap', '2', '--run', 'L2'])
    const out = JSON.parse(r.stdout)
    expect(out.green).toBe(false)
    expect(out.passes).toBe(2)
    expect(git(repo, 'rev-parse', '--verify', 'werk-loop/L2')).toMatch(/^[0-9a-f]{40}$/)
    // The worktree goes, the branch stays.
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })
})

// #ms-fail-cause: a check that could not judge the code says so itself, with no judgement.
describe('runCheck', () => {
  test('a missing command, an unrunnable one, and a timeout are check infra; a plain red and a stop are not', async () => {
    const { runCheck } = await import('./loop.ts')
    const cwd = makeRepo()
    expect((await runCheck(cwd, 'no-such-command-werk')).infra).toBe('command not found')
    expect((await runCheck(cwd, 'touch x.sh && ./x.sh')).infra).toBe('command not executable')
    expect((await runCheck(cwd, 'sleep 5', 100)).infra).toBe('killed after 100ms')
    const red = await runCheck(cwd, 'exit 1')
    expect([red.ok, red.infra]).toEqual([false, undefined])
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 50)
    expect((await runCheck(cwd, 'sleep 5', 10_000, stop.signal)).infra).toBeUndefined()
  })
})
