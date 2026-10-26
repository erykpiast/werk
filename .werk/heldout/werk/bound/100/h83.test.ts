/** Held-out steps 83.x: the builder loop. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../src/test/harness.ts'
import { boardTicket, branchOf, finishing, git, judges, lastFailure, project, prompts, runRecord, working } from './h8-build.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

// Scenario: A ticket that fails its checks once is green on the second pass
test('83.1 a ticket red once is green on the second pass', () => {
  p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '7'])
  // Then the build ends with a green result
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  // And the ticket branch has exactly two pass commits, "pass 1" and "pass 2"
  const subjects = git(p, 'log', '--format=%s', `main..${branchOf(r.stdout)}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toMatch(/pass 1$/)
  expect(subjects[0]).toMatch(/pass 2$/)
  // And the run record for the build has two lines, one for each pass
  const lines = runRecord(p)
  expect(lines.map((l) => l.pass)).toEqual([1, 2])
  // And each line shows the check results, the time, and the cost of its pass
  for (const l of lines) {
    expect(l.checks).toHaveLength(1)
    expect(l.checks[0].cmd).toBe('make check')
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  // And the first line shows the check as red and the second line shows the check as green
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
})

// Scenario: The next pass receives the last failure, cut to about 4,000 characters
test('83.2 the next pass gets the last failure, cut to about 4,000 characters', () => {
  p = project({ noise: 20_000 })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  expect(p.werk(['build', '7']).code).toBe(0)
  const [first, second] = prompts(p)
  expect(prompts(p)).toHaveLength(2)
  const failure = lastFailure(second!)
  // the prompt of the second builder agent names the failed check command
  expect(failure).toContain('make check')
  // And it holds the end of that command's output
  expect(failure).toContain('done.txt is missing TAIL-MARK')
  // And the failure text in that prompt is not longer than about 4,000 characters
  expect(failure.length).toBeLessThanOrEqual(4200)
  // And the prompt of the first builder agent holds no failure text
  expect(first).not.toContain('TAIL-MARK')
  expect(first).not.toContain('xxxxxxxxxx')
  expect(first).not.toContain('Exit code')
})

// Scenario: The build starts from the tip of the main line, not from the working tree
test('83.3 the build starts from the main tip, not from the working tree', () => {
  p = project()
  writeFileSync(join(p.dir, 'tip.txt'), 'the new tip\n')
  p.run(['git', 'add', 'tip.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  // Local changes that are not committed: a tracked file changed and a new file.
  writeFileSync(join(p.dir, 'tip.txt'), 'LOCAL-EDIT-NOT-COMMITTED\n')
  writeFileSync(join(p.dir, 'local.txt'), 'LOCAL-NEW-FILE\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const commits = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git(p, 'rev-parse', `${commits[0]}^1`)).toBe(tip)
  const patch = git(p, 'log', '-p', `main..${branch}`)
  expect(patch).not.toContain('LOCAL-EDIT-NOT-COMMITTED')
  expect(patch).not.toContain('LOCAL-NEW-FILE')
  expect(git(p, 'ls-tree', '--name-only', branch).split('\n')).not.toContain('local.txt')
  expect(readFileSync(join(p.dir, 'tip.txt'), 'utf8')).toBe('LOCAL-EDIT-NOT-COMMITTED\n')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('LOCAL-NEW-FILE\n')
  const status = git(p, 'status', '--porcelain')
  expect(status).toContain('tip.txt')
  expect(status).toContain('local.txt')
})

// Scenario: A builder that never converges stops at the retry cap and keeps its branch
test('83.4 a builder that never converges stops at 5 passes and keeps its branch', () => {
  p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working] } })
  const r = p.werk(['build', '7'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).not.toContain('green after')
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks[0].ok).toBe(false)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(boardTicket(p)).toBeDefined()
}, 60_000)
