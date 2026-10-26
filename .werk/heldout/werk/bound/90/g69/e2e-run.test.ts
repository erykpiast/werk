/** Held-out step 69.5: `make e2e` on a fresh checkout. */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

test('69.5 the person runs the browser tests and gets one screenshot per test', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
  const clone = join(tmp, 'werk')
  try {
    // Given a checkout of werk with the browser specs
    const c = Bun.spawnSync(['git', 'clone', '--quiet', ROOT, clone])
    expect(c.exitCode).toBe(0)
    const logs = ['log.jsonl', 'board.jsonl'].map((f) => join(clone, 'e2e', 'fixture-project', '.werk', f))
    const before = logs.map((p) => readFileSync(p, 'utf8'))
    const env = { ...process.env }
    delete env.WERK_LOG
    // When the person runs `make e2e`
    const r = Bun.spawnSync(['make', 'e2e'], { cwd: clone, env, stdout: 'pipe', stderr: 'pipe' })
    const out = r.stdout.toString() + r.stderr.toString()
    console.log(out.split('\n').filter((l) => /passed|failed|skipped|flaky/.test(l)).join('\n'))
    // Then the run reports a pass or fail result for each spec
    const results = out.split('\n').filter((l) => /^\s*[✓✘]/.test(l))
    const ran = Number(/(\d+) passed/.exec(out)?.[1] ?? 0) + Number(/(\d+) failed/.exec(out)?.[1] ?? 0)
    expect(ran).toBeGreaterThan(0)
    expect(results.length).toBe(ran)
    // The specs ran against a real server: the harness starts `werk serve` on a copy of the fixture.
    expect(readFileSync(join(clone, 'e2e', 'harness.ts'), 'utf8')).toContain("'serve'")
    // And one screenshot for each test that ran
    const shots = walk(join(clone, 'test-results')).filter((p) => p.endsWith('evidence.png'))
    expect(shots.length).toBe(ran)
    // And the project has no new events in its log
    expect(logs.map((p) => readFileSync(p, 'utf8'))).toEqual(before)
    const status = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: clone }).stdout.toString()
    expect(status).toBe('')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}, 600_000)
