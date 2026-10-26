/** Held-out step 69.5: `make e2e` on a fresh checkout. It runs on a clone in a temporary folder. */
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')

function evidence(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (f.endsWith('.png')) out.push(p)
    }
  }
  walk(dir)
  return out
}

test(
  '69.5 the person runs the browser tests and gets one screenshot per test',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'werk-h695-'))
    try {
      // Given a checkout of werk with the browser specs
      const clone = join(root, 'werk')
      const c = Bun.spawnSync(['git', 'clone', '--quiet', REPO, clone])
      expect(c.exitCode).toBe(0)
      // The project the person works in: a map with events, named by WERK_LOG in the person's shell.
      const work = join(root, 'work', '.werk')
      mkdirSync(work, { recursive: true })
      const workLog = join(work, 'log.jsonl')
      writeFileSync(workLog, readFileSync(join(REPO, 'e2e', 'fixture-project', '.werk', 'log.jsonl')))
      const before = readFileSync(workLog, 'utf8')
      const fixtureBefore = readFileSync(join(clone, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')

      // When the person runs `make e2e`
      const r = Bun.spawnSync(['make', 'e2e'], {
        cwd: clone,
        env: { ...process.env, WERK_LOG: workLog },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const out = r.stdout.toString() + r.stderr.toString()
      console.log(out.slice(-4000))

      // Then the browser specs run against a real server on a copy of the fixture project
      expect(readFileSync(join(clone, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')).toBe(fixtureBefore)
      // And the run reports a pass or fail result for each spec
      const results = out.split('\n').filter((l) => /^\s*[✓✘-]\s+\d+ \[chromium\]/.test(l))
      const total = Number(out.match(/(\d+) passed/)?.[1] ?? 0) + Number(out.match(/(\d+) failed/)?.[1] ?? 0)
      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBe(total)
      const specs = readdirSync(join(clone, 'e2e')).filter((f) => f.endsWith('.spec.ts'))
      for (const s of specs) expect(results.some((l) => l.includes(s))).toBe(true)
      // And the run leaves one screenshot for each test that ran
      const shots = evidence(join(clone, 'test-results'))
      expect(shots.length).toBe(results.length)
      // And the project the person works in has no new events in its log after the run
      expect(readFileSync(workLog, 'utf8')).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  { timeout: 900_000 },
)
