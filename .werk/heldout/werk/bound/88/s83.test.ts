import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../src/test/harness.ts'
import {
  boardTicket,
  branchOf,
  buildRoles,
  finishing,
  git,
  judges,
  lastFailure,
  prompts,
  runRecord,
  setupProject,
  working,
} from './s83-helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})
const LINES = ['ac-1', '#loop']

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  p = setupProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green after 2 pass(es)')
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--format=%s', `main..${branch}`).split('\n')).toEqual(['werk build 3: pass 2', 'werk build 3: pass 1'])
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks)).toBe(true)
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks).toMatchObject([{ cmd: 'make check', ok: false }])
  expect(lines[1].checks).toMatchObject([{ cmd: 'make check', ok: true }])
}, 60_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  p = setupProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const [first, second] = prompts(p)
  expect(prompts(p)).toHaveLength(2)
  const failure = lastFailure(second!)
  expect(failure).toContain('make check')
  expect(failure).toContain('done.txt is missing END-MARK')
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(failure.length).toBeGreaterThan(3000)
  expect(first).not.toContain('END-MARK')
  expect(first).not.toContain('Command: make check')
  expect(lastFailure(first!)).toBe('Nothing has failed yet.')
}, 60_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  p = setupProject()
  writeFileSync(join(p.dir, 'tracked.txt'), 'committed\n')
  p.run(['git', 'add', 'tracked.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'tracked.txt'), 'LOCAL-CHANGE\n')
  writeFileSync(join(p.dir, 'untracked.txt'), 'LOCAL-UNTRACKED\n')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const commits = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git(p, 'rev-parse', `${commits[0]}^1`)).toBe(tip)
  for (const c of commits) {
    expect(git(p, 'show', `${c}:tracked.txt`)).toBe('committed')
    expect(git(p, 'ls-tree', '-r', '--name-only', c).split('\n')).not.toContain('untracked.txt')
  }
  expect(readFileSync(join(p.dir, 'tracked.txt'), 'utf8')).toBe('LOCAL-CHANGE\n')
  expect(readFileSync(join(p.dir, 'untracked.txt'), 'utf8')).toBe('LOCAL-UNTRACKED\n')
  const status = git(p, 'status', '--porcelain')
  expect(status).toContain('tracked.txt')
  expect(status).toContain('untracked.txt')
}, 60_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  p = setupProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(5)
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  expect(git(p, 'log', '--format=%s', `main..${branch}`).split('\n')).toEqual(
    [5, 4, 3, 2, 1].map((n) => `werk build 3: pass ${n}`),
  )
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 120_000)

test('83.5 the board shows the ticket in building with its retry count (board log fold, during and after)', async () => {
  p = setupProject()
  expect(boardTicket(p)).toEqual({ column: 'ready', number: 3, retries: 0 })
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, working, finishing] } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'cli', 'main.ts'), 'build', '3'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const seen = new Set<string>()
  let done = false
  void child.exited.then(() => (done = true))
  while (!done) {
    const t = boardTicket(p)
    if (t) seen.add(t.column)
    await Bun.sleep(30)
  }
  expect(await child.exited).toBe(0)
  expect(seen.has('building')).toBe(true)
  expect(boardTicket(p)).toEqual({ column: 'building', number: 3, retries: 2 })
}, 60_000)
