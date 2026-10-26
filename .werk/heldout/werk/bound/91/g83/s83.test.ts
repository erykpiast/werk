import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { boardTicket, branchOf, finishing, gitOf, judges, project, prompts, result, runRecord, working } from './helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const LINES = ['ac-1', '#loop']

test('83.1 A ticket that fails its checks once is green on the second pass', () => {
  p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/green/)
  const git = gitOf(p)
  const branch = branchOf(r.stdout)!
  expect(git('log', '--format=%s', `main..${branch}`).split('\n')).toEqual(['werk build 3: pass 2', 'werk build 3: pass 1'])
  const rec = runRecord(p)
  expect(rec).toHaveLength(2)
  for (const line of rec) {
    expect(Array.isArray(line.checks) && line.checks.length > 0).toBe(true)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
  expect(rec[0].checks[0].ok).toBe(false)
  expect(rec[1].checks[0].ok).toBe(true)
})

test('83.2 The next pass receives the last failure, cut to about 4,000 characters', () => {
  const makefile = [
    'check:',
    '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" x; echo; echo "THE-END-OF-OUTPUT"; exit 1; }',
    '',
  ].join('\n')
  p = project({ makefile })
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const [first, second] = prompts(p)
  const failure = second!.slice(second!.indexOf('## Last failure'))
  console.log('failure section length', failure.length)
  expect(failure).toContain('make check')
  expect(failure).toContain('THE-END-OF-OUTPUT')
  expect(failure.length).toBeLessThanOrEqual(4300)
  expect(first).not.toContain('THE-END-OF-OUTPUT')
  expect(first).not.toContain('make check failed')
  expect(first!.slice(first!.indexOf('## Last failure'))).not.toContain('Command:')
})

test('83.3 The build starts from the tip of the main line, not from the working tree', () => {
  p = project()
  const git = gitOf(p)
  writeFileSync(join(p.dir, 'feature.txt'), 'committed\n')
  git('add', 'feature.txt')
  git('commit', '--quiet', '-m', 'A new commit at the tip')
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'feature.txt'), 'LOCAL-UNCOMMITTED-CHANGE\n')
  writeFileSync(join(p.dir, 'local-only.txt'), 'LOCAL-UNTRACKED\n')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)!
  const commits = git('rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git('rev-parse', `${commits[0]}^1`)).toBe(tip)
  for (const c of commits) {
    expect(git('show', `${c}:feature.txt`)).toBe('committed')
    expect(git('ls-tree', '--name-only', '-r', c).split('\n')).not.toContain('local-only.txt')
  }
  expect(readFileSync(join(p.dir, 'feature.txt'), 'utf8')).toBe('LOCAL-UNCOMMITTED-CHANGE\n')
  expect(existsSync(join(p.dir, 'local-only.txt'))).toBe(true)
})

test('83.4 A builder that never converges stops at the retry cap and keeps its branch', () => {
  p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toMatch(/cap of 5/)
  const branch = branchOf(r.stdout)!
  const git = gitOf(p)
  expect(git('rev-parse', '--verify', branch)).not.toBe('')
  expect(git('rev-list', '--count', `main..${branch}`)).toBe('5')
  const rec = runRecord(p)
  expect(rec).toHaveLength(5)
  for (const line of rec) {
    expect(line.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
}, 60_000)

test('83.5 The board shows the ticket in building with its retry count', () => {
  p = project()
  expect(boardTicket(p)!.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const t = boardTicket(p)!
  expect(t.column).toBe('building')
  expect(t.retries).toBe(2)
}, 30_000)
