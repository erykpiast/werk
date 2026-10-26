/** Held-out steps 83.1 to 83.5: the builder loop of one ticket. */
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boardTicket, branchOf, buildProject, buildRoles, finishing, git, judges, prompts, runRecord, working } from './lib.ts'

const LINES = ['ac-1', '#loop']

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  const p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--format=%s', `main..${branch}`).split('\n').toReversed()).toEqual([
    expect.stringMatching(/pass 1$/),
    expect.stringMatching(/pass 2$/),
  ])
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.at).toBe('string')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
}, 30_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  const makefile = 'check:\n\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" x; echo; echo "TAIL-OF-OUTPUT"; exit 1; }\n'
  const p = buildProject({ makefile })
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  expect(p.werk(['build', '3']).code).toBe(0)
  const [first, second] = prompts(p)
  const failureOf = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure'))
  const failure = failureOf(second!)
  expect(failure).toContain('make check')
  expect(failure).toContain('TAIL-OF-OUTPUT')
  const text = failure.slice('## Last failure\n\n'.length)
  expect(text.length).toBeLessThanOrEqual(4200)
  expect(text.length).toBeGreaterThan(3000)
  expect(first!).not.toContain('TAIL-OF-OUTPUT')
  expect(first!).not.toContain('xxxxxxxxxx')
  expect(failureOf(first!)).not.toContain('make check')
}, 30_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  const p = buildProject()
  writeFileSync(join(p.dir, 'feature.txt'), 'committed\n')
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'feature.txt'), 'LOCAL-CHANGE\n')
  writeFileSync(join(p.dir, 'untracked.txt'), 'LOCAL-UNTRACKED\n')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  const branch = branchOf(r.stdout)
  const commits = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git(p, 'rev-parse', `${commits[0]}^1`)).toBe(tip)
  expect(p.run(['git', 'grep', '-q', 'LOCAL-CHANGE', branch]).code).toBe(1)
  expect(p.run(['git', 'grep', '-q', 'LOCAL-UNTRACKED', branch]).code).toBe(1)
  expect(git(p, 'log', '--format=%H', `main..${branch}`, '--', 'untracked.txt')).toBe('')
  expect(readFileSync(join(p.dir, 'feature.txt'), 'utf8')).toBe('LOCAL-CHANGE\n')
  expect(readFileSync(join(p.dir, 'untracked.txt'), 'utf8')).toBe('LOCAL-UNTRACKED\n')
}, 30_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  const p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(5)
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 60_000)

test('83.5 the board shows the ticket in building with its retry count', () => {
  const p = buildProject()
  expect(boardTicket(p)?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, working, finishing] } })
  expect(p.werk(['build', '3']).code).toBe(0)
  expect(boardTicket(p)).toEqual({ column: 'building', number: 3, retries: 2 })
}, 30_000)
