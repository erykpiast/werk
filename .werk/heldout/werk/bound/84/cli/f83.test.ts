/** Feature 83: the builder loop. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { boardTicket, branchOf, buildProject, finishing, git, judges, lastFailure, prompts, runRecord, TICKET, working } from './build-helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const LINES = ['ac-1', 'ac-2', '#store']

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', String(TICKET)])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)!
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toMatch(/pass 1$/)
  expect(subjects[0]).toMatch(/pass 2$/)
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
})

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  p = buildProject({ fill: 20_000 })
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  expect(p.werk(['build', String(TICKET)]).code).toBe(0)
  const [first, second] = prompts(p)
  const failure = lastFailure(second!)
  expect(failure).toContain('make check')
  expect(failure).toContain('done.txt is missing END-MARK')
  expect(failure.length).toBeLessThanOrEqual(4100)
  expect(lastFailure(first!)).not.toContain('make check')
  expect(first!).not.toContain('END-MARK')
  expect(first!).not.toContain('xxxxxxxx')
})

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  p = buildProject()
  writeFileSync(join(p.dir, 'notes.txt'), 'committed\n')
  p.run(['git', 'add', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'notes.txt'), 'committed\nLOCAL-CHANGE\n')
  writeFileSync(join(p.dir, 'local.txt'), 'LOCAL-UNTRACKED\n')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing] } })
  const r = p.werk(['build', String(TICKET)])
  const branch = branchOf(r.stdout)!
  const firstPass = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git(p, 'rev-parse', `${firstPass}^1`)).toBe(tip)
  for (const c of git(p, 'rev-list', `main..${branch}`).split('\n')) {
    expect(git(p, 'show', `${c}:notes.txt`)).not.toContain('LOCAL-CHANGE')
    expect(git(p, 'ls-tree', '--name-only', c).split('\n')).not.toContain('local.txt')
  }
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toContain('LOCAL-CHANGE')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toContain('LOCAL-UNTRACKED')
})

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working] } })
  const r = p.werk(['build', String(TICKET)])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toMatch(/stopped|cap/)
  const branch = branchOf(r.stdout)!
  expect(git(p, 'rev-parse', '--verify', `refs/heads/${branch}`)).not.toBe('')
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
})

test('83.5 the board shows the ticket in building with its retry count', () => {
  p = buildProject()
  expect(boardTicket(p)?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, working, finishing] } })
  expect(p.werk(['build', String(TICKET)]).code).toBe(0)
  expect(boardTicket(p)).toEqual({ column: 'building', number: TICKET, retries: 2 })
})
