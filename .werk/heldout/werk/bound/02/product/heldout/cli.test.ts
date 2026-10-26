import { afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLI, FAKE_AGENT_DIR, testEnv } from '../test/env.ts'
import { makeProject, type TempProject } from '../test/harness.ts'

// ---------- 02.1 ----------
test('02.1 a retitle appends one event and the map shows only the new title', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-021-')))
  const werk = (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: testEnv(), encoding: 'utf8' })
    return { code: r.status, out: r.stdout, err: r.stderr }
  }
  try {
    // Given an empty map
    expect(existsSync(join(dir, '.werk', 'log.jsonl'))).toBe(false)
    expect(werk('add', 'a', '--title', 'Use a log').code).toBe(0)
    expect(werk('add', 'b', '--title', 'Cards fold from it').code).toBe(0)
    expect(werk('link', 'b', 'a', '--type', 'refines').code).toBe(0)
    const logFile = join(dir, '.werk', 'log.jsonl')
    const saved = readFileSync(logFile)
    const savedLines = saved.toString().split('\n').filter(Boolean)

    const r = werk('retitle', 'a', 'Use an append-only log')
    expect(r.code).toBe(0)

    const now = readFileSync(logFile)
    const nowLines = now.toString().split('\n').filter(Boolean)
    expect(nowLines.length).toBe(savedLines.length + 1)
    expect(now.subarray(0, saved.length).equals(saved)).toBe(true)

    const map = werk('show')
    expect(map.code).toBe(0)
    const mapJson = JSON.parse(map.out)
    const aInMap = mapJson.children.find((c: { id: string }) => c.id === 'a')
    expect(aInMap.title).toBe('Use an append-only log')

    const show = werk('show', 'a')
    expect(show.code).toBe(0)
    expect(show.out).toContain('Use an append-only log')
    const showJson = JSON.parse(show.out)
    expect(showJson.card.title).toBe('Use an append-only log')

    // neither prints "Use a log" as the title of card a
    expect(aInMap.title).not.toBe('Use a log')
    expect(showJson.card.title).not.toBe('Use a log')
    expect(map.out).not.toContain('"Use a log"')
    expect(show.out).not.toContain('"Use a log"')

    expect(now.toString()).toContain('"Use a log"')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 01.5 ----------
let seenDir: string | undefined
let project: TempProject | undefined

test('01.5 a command-line test runs a werk command against a temporary project', () => {
  // The test asks the harness for a temp project with a git repository.
  project = makeProject()
  seenDir = project.dir
  expect(existsSync(join(project.dir, '.git'))).toBe(true)
  expect(project.git(['rev-parse', 'HEAD']).code).toBe(0)
  // It runs a werk command against that project.
  const result = project.run(['add', 'x', '--title', 'A card'])
  // It reads the exit code and the output.
  expect(result.code).toBe(0)
  expect(typeof result.stdout).toBe('string')
  expect(result.stdout.length).toBeGreaterThan(0)
  const bad = project.run(['nope'])
  expect(bad.code).toBe(1)
  expect(bad.stderr).toContain('unknown command')
  // Any agent the werk command calls is the scripted fake agent: `claude` on the command's PATH is the fake.
  const which = spawnSync('sh', ['-c', 'command -v claude'], { cwd: project.dir, env: testEnv(), encoding: 'utf8' })
  expect(which.stdout.trim()).toBe(join(FAKE_AGENT_DIR, 'claude'))
  // The test does not remove the project itself: the step says the project is gone after the test ends.
})

test('01.5 (after) the temporary project from the previous test is gone', () => {
  expect(seenDir).toBeDefined()
  const stillThere = existsSync(seenDir!)
  expect(stillThere).toBe(false)
})

afterAll(() => {
  // Binder housekeeping only, after all checks ran.
  project?.cleanup()
})
