/** Held-out steps 83.1 to 83.5: the build verb with a fake builder. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { boardTicket, branchOf, buildProject, finishing, git, judges, prompts, runRecord, working } from './build-helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const IDS = ['ac-1', '#loop']

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(IDS), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/green/)
  const branch = branchOf(r.stdout)
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n').toReversed()
  expect(subjects).toHaveLength(2)
  expect(subjects[0]).toContain('pass 1')
  expect(subjects[1]).toContain('pass 2')
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const line of lines) {
    expect(Array.isArray(line.checks)).toBe(true)
    expect(line.checks.length).toBeGreaterThan(0)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
  expect(lines[0].checks[0]).toMatchObject({ cmd: 'make check', ok: false })
  expect(lines[1].checks[0]).toMatchObject({ cmd: 'make check', ok: true })
})

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  p = buildProject({ bytes: 20000 })
  p.scriptAgent({ steps: [], roles: { ...judges(IDS), builder: [working, finishing] } })
  expect(p.werk(['build', '3']).code).toBe(0)
  const [first, second] = prompts(p)
  expect(second).toBeDefined()
  const marker = '## Last failure\n\n'
  const failure = second!.slice(second!.indexOf(marker) + marker.length)
  expect(second!.indexOf(marker)).toBeGreaterThan(-1)
  expect(failure).toContain('make check')
  expect(failure).toContain('done.txt is missing END-MARK')
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(first).not.toContain('END-MARK')
  expect(first).not.toContain('xxxxxxxxxx')
  expect(first).not.toContain('Exit code')
})

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  p = buildProject()
  writeFileSync(join(p.dir, 'tip.txt'), 'tip\n')
  p.run(['git', 'add', 'tip.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'tip.txt'), 'local change\n')
  writeFileSync(join(p.dir, 'untracked.txt'), 'local new file\n')
  p.scriptAgent({ steps: [], roles: { ...judges(IDS), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  const branch = branchOf(r.stdout)
  const commits = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git(p, 'rev-parse', `${commits[0]}^1`)).toBe(tip)
  for (const c of commits) {
    expect(git(p, 'show', `${c}:tip.txt`)).toBe('tip')
    expect(git(p, 'ls-tree', '--name-only', c).split('\n')).not.toContain('untracked.txt')
  }
  expect(readFileSync(join(p.dir, 'tip.txt'), 'utf8')).toBe('local change\n')
  expect(readFileSync(join(p.dir, 'untracked.txt'), 'utf8')).toBe('local new file\n')
})

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(IDS), builder: [working] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/5 passes|fail|red/)
  const branch = branchOf(r.stdout)
  expect(git(p, 'rev-parse', '--verify', branch)).not.toBe('')
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const line of lines) {
    expect(line.green).toBe(false)
    expect(line.checks[0]).toMatchObject({ ok: false })
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
})

test('83.5 the board shows the ticket in building with its retry count', () => {
  p = buildProject()
  expect(boardTicket(p)?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(IDS), builder: [working, working, finishing] } })
  expect(p.werk(['build', '3']).code).toBe(0)
  expect(boardTicket(p)).toMatchObject({ column: 'building', retries: 2 })
})
