/** 69.5: the person runs `make e2e` on a checkout of werk with the browser specs. */
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

function walk(dir: string, name: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p, name))
    else if (e === name) out.push(p)
  }
  return out
}

test(
  '69.5 make e2e runs the browser specs and leaves one screenshot per test',
  () => {
    const tmp = mkdtempSync(join(tmpdir(), 'werk-695-'))
    try {
      const clone = join(tmp, 'werk')
      const c = Bun.spawnSync(['git', 'clone', '--quiet', ROOT, clone], { stdout: 'pipe', stderr: 'pipe' })
      expect(c.exitCode).toBe(0)
      // The project the person works in: a map with events, named by WERK_LOG in the shell.
      const work = join(tmp, 'mywork', '.werk')
      mkdirSync(work, { recursive: true })
      const log = join(work, 'log.jsonl')
      const line = JSON.stringify({ seq: 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type: 'node.proposed', payload: { id: 'mine', kind: 'card', title: 'Mine' } })
      writeFileSync(log, line + '\n')
      const before = readFileSync(log, 'utf8')
      const env: Record<string, string> = { ...(process.env as Record<string, string>), WERK_LOG: log, CI: 'true' }
      const r = Bun.spawnSync(['make', 'e2e'], { cwd: clone, env, stdout: 'pipe', stderr: 'pipe' })
      const out = r.stdout.toString() + r.stderr.toString()
      console.log(out.slice(-4000))
      // The run reports a result per test (list reporter: ✓ or ✘ lines) and a summary.
      const results = out.split('\n').filter((l) => /^\s*(✓|✘|-)\s+\d+/.test(l))
      expect(results.length).toBeGreaterThan(0)
      expect(out).toMatch(/\d+ (passed|failed)/)
      // Browser specs ran against a real server on a copy of the fixture: specs from e2e/ appear.
      expect(results.some((l) => l.includes('e2e/map.spec.ts') || l.includes('map.spec.ts'))).toBe(true)
      const finals = new Set(results.map((l) => l.replace(/^\s*(✓|✘|-)\s+\d+\s+/, '').replace(/\s*\(\d.*\)$/, '').replace(/ \(retry #\d+\)/, '')))
      const shots = walk(join(clone, 'test-results'), 'evidence.png')
      expect(shots.length).toBe(finals.size)
      expect(readFileSync(log, 'utf8')).toBe(before)
      expect(r.exitCode).toBe(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  },
  1_800_000,
)
