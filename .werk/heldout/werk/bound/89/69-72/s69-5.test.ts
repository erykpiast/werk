import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WORKTREE = resolve(import.meta.dir, '..', '..')

function sh(cmd: string[], cwd: string, timeoutMs = 1_500_000) {
  const env = { ...process.env } as Record<string, string>
  delete env.WERK_LOG
  delete env.HELDOUT_OUT
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

function findFiles(dir: string, name: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) found.push(...findFiles(p, name))
    else if (e === name) found.push(p)
  }
  return found
}

// 69.5
// Scenario: The person runs the browser tests and gets one screenshot per test
// Given a checkout of werk with the browser specs
// When the person runs `make e2e`
// Then the browser specs run against a real server on a copy of the fixture project
// And the run reports a pass or fail result for each spec
// And the run leaves one screenshot for each test that ran
// And the project the person works in has no new events in its log after the run
test(
  '69.5 make e2e runs every spec and leaves one screenshot per test',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'werk-6972-e2e-'))
    const dir = join(root, 'werk')
    const sha = sh(['git', 'rev-parse', 'HEAD'], WORKTREE).out.trim()
    expect(sh(['git', 'clone', '--quiet', WORKTREE, dir], root).code).toBe(0)
    expect(sh(['git', 'checkout', '--quiet', sha], dir).code).toBe(0)

    const fixtureLog = join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
    const rootLog = join(dir, '.werk', 'log.jsonl')
    const fixtureBefore = readFileSync(fixtureLog, 'utf8')
    const rootBefore = existsSync(rootLog) ? readFileSync(rootLog, 'utf8') : null

    const specs = readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))
    expect(specs.length).toBeGreaterThan(0)

    const r = sh(['make', 'e2e'], dir)
    console.log(r.out.slice(-4000))

    // A result line per test: list reporter marks each test with ✓ or ✘ (or "ok"/"x").
    const resultLines = r.out.split('\n').filter((l) => /^\s*(✓|✘|ok|x|-)\s+\d+\s+\[chromium\]/.test(l))
    const testsRan = resultLines.length
    console.log('tests reported:', testsRan, 'exit:', r.code)
    expect(testsRan).toBeGreaterThan(0)
    for (const spec of specs) expect(resultLines.some((l) => l.includes(spec))).toBe(true)
    expect(r.out).toMatch(/\d+ (passed|failed)/)

    // One screenshot per test that ran (skipped tests excluded).
    const skipped = resultLines.filter((l) => /^\s*-\s/.test(l)).length
    const shots = findFiles(join(dir, 'test-results'), 'evidence.png')
    console.log('screenshots:', shots.length, 'skipped:', skipped)
    expect(shots.length).toBe(testsRan - skipped)

    // The project the person works in: the clone's own logs are unchanged.
    expect(readFileSync(fixtureLog, 'utf8')).toBe(fixtureBefore)
    expect(existsSync(rootLog) ? readFileSync(rootLog, 'utf8') : null).toBe(rootBefore)
    // The specs ran against a real server: the harness spawns `werk serve` on a copy.
    expect(readFileSync(join(dir, 'e2e', 'harness.ts'), 'utf8')).toContain("'serve', '--port', '0'")
  },
  1_600_000,
)
