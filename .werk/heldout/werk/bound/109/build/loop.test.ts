/** Held-out steps 83.1 - 83.4: the builder loop through `werk build`. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TicketFields } from '../../src/board/events.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { branchOf, git, judges, makeBuildProject, prompts, result, runRecord } from './helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

const MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')
/** The check prints about 20,000 characters and a tail mark, and fails, until done.txt is there. */
const LONG_MAKEFILE = [
  'check:',
  '\t@test -f done.txt || { echo HEAD-MARK; head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-MARK the end of the output"; exit 1; }',
  '',
].join('\n')

const ticket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}
const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
const LINES = ['ac-1', '#loop']

const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

const setup = (makefile = MAKEFILE, files?: Record<string, string>) => (p = makeBuildProject({ makefile, ticket, log, files }))

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  const p = setup()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  // The build ends with a green result.
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  // The ticket branch has exactly two pass commits, "pass 1" and "pass 2".
  const branch = branchOf(r.stdout)
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n').toReversed()
  expect(subjects).toHaveLength(2)
  expect(subjects[0]).toMatch(/pass 1$/)
  expect(subjects[1]).toMatch(/pass 2$/)
  // The run record has two lines, one per pass.
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  expect(lines.map((l) => l.pass)).toEqual([1, 2])
  // Each line shows the check results, the time and the cost of its pass.
  for (const l of lines) {
    expect(Array.isArray(l.checks)).toBe(true)
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].costUsd).toBe(0.1)
  expect(lines[1].costUsd).toBe(0.2)
  // The first line shows the check red, the second line green.
  expect(lines[0].checks).toMatchObject([{ cmd: 'make check', ok: false }])
  expect(lines[1].checks).toMatchObject([{ cmd: 'make check', ok: true }])
}, 30_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  const p = setup(LONG_MAKEFILE)
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const builders = prompts(p, 'builder')
  expect(builders).toHaveLength(2)
  const [first, second] = builders as [string, string]
  const marker = '## Last failure\n\n'
  const failure = second.slice(second.indexOf(marker) + marker.length)
  // The second prompt names the failed check command.
  expect(failure).toContain('make check')
  // It holds the end of that command's output.
  expect(failure).toContain('TAIL-MARK the end of the output')
  // The failure text is not longer than about 4,000 characters.
  expect(failure.length).toBeLessThanOrEqual(4100)
  // The first prompt holds no failure text.
  expect(first).not.toContain('TAIL-MARK')
  expect(first).not.toContain('HEAD-MARK')
  expect(first).not.toContain('yyyyyyyyyy')
  expect(first).not.toContain('Exit code')
}, 30_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  const p = setup(MAKEFILE, { 'tracked.txt': 'committed\n' })
  // A new commit at the tip of main.
  writeFileSync(join(p.dir, 'tip.txt'), 'tip\n')
  p.run(['git', 'add', 'tip.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  // Local changes that are not committed: a changed tracked file and a new file.
  writeFileSync(join(p.dir, 'tracked.txt'), 'LOCAL-CHANGE-MARK\n')
  writeFileSync(join(p.dir, 'untracked.txt'), 'LOCAL-NEW-MARK\n')
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing] } })

  const r = p.werk(['build', '3'])
  const branch = branchOf(r.stdout)
  const commits = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n').filter(Boolean)
  expect(commits.length).toBeGreaterThan(0)
  // The first parent of the first pass commit is the main tip at the start.
  expect(git(p, 'rev-parse', `${commits[0]}^1`)).toBe(tip)
  // The local changes are in no commit on the ticket branch.
  for (const c of commits) {
    expect(p.run(['git', 'grep', '-q', 'LOCAL-CHANGE-MARK', c]).code).toBe(1)
    expect(p.run(['git', 'grep', '-q', 'LOCAL-NEW-MARK', c]).code).toBe(1)
  }
  expect(git(p, 'log', '-p', `main..${branch}`)).not.toContain('LOCAL-')
  // The main checkout still has its local changes.
  expect(readFileSync(join(p.dir, 'tracked.txt'), 'utf8')).toBe('LOCAL-CHANGE-MARK\n')
  expect(readFileSync(join(p.dir, 'untracked.txt'), 'utf8')).toBe('LOCAL-NEW-MARK\n')
  const status = git(p, 'status', '--porcelain')
  expect(status).toContain('tracked.txt')
  expect(status).toContain('untracked.txt')
}, 30_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  const p = setup()
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [working] } })
  const r = p.werk(['build', '3'])
  // The build stops after 5 passes and reports a failed result.
  expect(r.code).not.toBe(0)
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(5)
  expect(r.stdout).toMatch(/stopped at the retry cap of 5|fail/i)
  // The ticket branch still exists with 5 pass commits.
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(5)
  for (const s of subjects) expect(s).toMatch(/pass \d$/)
  // The run record has 5 lines, each with a red check result, a time and a cost.
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 60_000)
