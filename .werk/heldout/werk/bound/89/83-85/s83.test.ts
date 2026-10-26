import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import {
  boardTicket,
  branchOf,
  buildRoles,
  finishing,
  gitOf,
  judges,
  lastFailure,
  project,
  prompts,
  runRecord,
  working,
} from './util.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

// 83.1
// Scenario: A ticket that fails its checks once is green on the second pass
// Given a project repository with a main line and one ready ticket on the board
// And the ticket has one check command
// And the builder agent leaves the check red on its first pass and makes it green on its second pass
// When the person starts the build of the ticket
// Then the build ends with a green result
// And the ticket branch has exactly two pass commits, "pass 1" and "pass 2"
// And the run record for the build has two lines, one for each pass
// And each line shows the check results, the time, and the cost of its pass
// And the first line shows the check as red and the second line shows the check as green
test('83.1', () => {
  p = project()
  const git = gitOf(p)
  expect(boardTicket(p)?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  console.log('83.1 stdout:\n' + r.stdout + '\nstderr:\n' + r.stderr)
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)
  const subjects = git('log', '--format=%s', `main..${branch}`).split('\n')
  console.log('83.1 subjects', subjects)
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toContain('pass 1')
  expect(subjects[0]).toContain('pass 2')
  const lines = runRecord(p)
  console.log('83.1 run record', JSON.stringify(lines.map((l) => ({ pass: l.pass, checks: l.checks, ms: l.ms, costUsd: l.costUsd }))))
  expect(lines).toHaveLength(2)
  expect(lines.map((l) => l.pass)).toEqual([1, 2])
  for (const l of lines) {
    expect(Array.isArray(l.checks)).toBe(true)
    expect(l.checks.length).toBe(1)
    expect(l.checks[0].cmd).toBe('make check')
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
}, 120_000)

// 83.2
// Scenario: The next pass receives the last failure, cut to about 4,000 characters
// Given a project repository with one ready ticket
// And the ticket has a check command that prints about 20,000 characters and exits with an error on the first run
// And the builder agent makes the check pass on its second pass
// When the person starts the build of the ticket
// Then the prompt of the second builder agent names the failed check command
// And it holds the end of that command's output
// And the failure text in that prompt is not longer than about 4,000 characters
// And the prompt of the first builder agent holds no failure text
test('83.2', () => {
  const makefile = [
    'check:',
    '\t@test -f done.txt || { echo "START-MARK"; head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "the output ends here TAIL-MARK"; exit 1; }',
    '',
  ].join('\n')
  p = project({ makefile })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  console.log('83.2 stdout:\n' + r.stdout)
  const [first, second] = prompts(p)
  expect(second).toBeDefined()
  const failure = lastFailure(second!)
  console.log(`83.2 failure length ${failure.length}; head: ${JSON.stringify(failure.slice(0, 200))}; tail: ${JSON.stringify(failure.slice(-120))}`)
  expect(failure).toContain('make check')
  expect(failure).toContain('TAIL-MARK')
  expect(failure).not.toContain('START-MARK')
  // "about 4,000": allow a small margin above 4,000.
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(failure.length).toBeGreaterThan(1000)
  const firstFailure = lastFailure(first!)
  console.log('83.2 first prompt last-failure section: ' + JSON.stringify(firstFailure))
  expect(first).not.toContain('TAIL-MARK')
  expect(first).not.toContain('Exit code')
  expect(firstFailure).toBe('Nothing has failed yet.')
}, 120_000)

// 83.3
// Scenario: The build starts from the tip of the main line, not from the working tree
// Given a project repository whose main line has a new commit at its tip
// And the main checkout has local changes that are not committed
// When the person starts the build of a ready ticket
// Then the first parent of the ticket's first pass commit is the commit that was the main line's tip when the build started
// And the local, uncommitted changes are not in any commit on the ticket branch
// And the main checkout still has its local changes
test('83.3', () => {
  p = project()
  const git = gitOf(p)
  writeFileSync(join(p.dir, 'notes.txt'), 'committed text\n')
  p.run(['git', 'add', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'notes.txt'), 'committed text\nLOCAL-EDIT-MARK\n')
  writeFileSync(join(p.dir, 'local-only.txt'), 'LOCAL-NEW-FILE-MARK\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  console.log('83.3 stdout:\n' + r.stdout + '\nstderr:\n' + r.stderr)
  const branch = branchOf(r.stdout)
  const commits = git('rev-list', '--reverse', `main..${branch}`).split('\n').filter(Boolean)
  expect(commits.length).toBeGreaterThanOrEqual(1)
  expect(git('rev-parse', `${commits[0]}^1`)).toBe(tip)
  const patch = git('log', '-p', `main..${branch}`)
  expect(patch).not.toContain('LOCAL-EDIT-MARK')
  expect(patch).not.toContain('LOCAL-NEW-FILE-MARK')
  expect(git('ls-tree', '-r', '--name-only', branch).split('\n')).not.toContain('local-only.txt')
  expect(git('show', `${branch}:notes.txt`)).toBe('committed text')
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('committed text\nLOCAL-EDIT-MARK\n')
  expect(readFileSync(join(p.dir, 'local-only.txt'), 'utf8')).toBe('LOCAL-NEW-FILE-MARK\n')
  expect(git('status', '--porcelain')).toContain('notes.txt')
}, 120_000)

// 83.4
// Scenario: A builder that never converges stops at the retry cap and keeps its branch
// Given a project repository with one ready ticket
// And the builder agent never makes the ticket's check pass
// When the person starts the build of the ticket with the default retry cap
// Then the build stops after 5 passes and reports a failed result
// And the ticket branch still exists with 5 pass commits
// And the run record has 5 lines, each with a red check result, a time, and a cost
test('83.4', () => {
  p = project()
  const git = gitOf(p)
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working] } })
  const r = p.werk(['build', '3'])
  console.log('83.4 stdout:\n' + r.stdout)
  expect(r.code).not.toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(5)
  expect(r.stdout).toMatch(/stopped at the retry cap of 5 passes|fail/)
  const branch = branchOf(r.stdout)
  expect(p.run(['git', 'rev-parse', '--verify', `refs/heads/${branch}`]).code).toBe(0)
  const subjects = git('log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(5)
  for (const [i, s] of subjects.toReversed().entries()) expect(s).toContain(`pass ${i + 1}`)
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.length).toBeGreaterThan(0)
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 120_000)

// 83.5
// Scenario: The board shows the ticket in building with its retry count
// Given a project repository with one ready ticket shown in the ready column of the board
// And the builder agent leaves the check red on its first two passes and makes it green on its third pass
// When the person starts the build of the ticket
// Then the board shows the ticket in the building column
// And the board shows the retry count of the ticket as 2 when the build ends
test('83.5', async () => {
  p = project()
  expect(boardTicket(p)?.column).toBe('ready')
  const release = join(p.dir, '..', 'release-83-5')
  const held = { steps: [{ waitFor: release }, ...working.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [held, working, finishing] } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'build', '3'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  // Observe the board while the first builder is held.
  let during: ReturnType<typeof boardTicket>
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    during = boardTicket(p)
    if (during?.column === 'building' && existsSync(join(p.dir, '.werk', 'sessions', '3.json'))) break
    await Bun.sleep(100)
  }
  console.log('83.5 during build', JSON.stringify(during!))
  writeFileSync(release, 'go')
  const code = await child.exited
  const out = await new Response(child.stdout).text()
  console.log('83.5 stdout:\n' + out)
  expect(during!?.column).toBe('building')
  expect(code).toBe(0)
  const after = boardTicket(p)
  console.log('83.5 after build', JSON.stringify(after))
  expect(after?.retries).toBe(2)
}, 120_000)
