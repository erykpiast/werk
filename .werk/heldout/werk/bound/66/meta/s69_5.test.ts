/** 69.5: make e2e in a fresh clone of this checkout. The checkout itself is not touched. */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', '..')
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: SRC }).stdout.toString().trim()

const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)])) : []

test(
  '69.5 the person runs the browser tests and gets one screenshot per test',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-clone-'))
    try {
      const dir = join(root, 'werk')
      expect(Bun.spawnSync(['git', 'clone', '--quiet', SRC, dir]).exitCode).toBe(0)
      const env = { ...process.env, CI: 'true' } as Record<string, string>
      delete env.WERK_LOG
      const run = (cmd: string[]) => {
        const p = Bun.spawnSync(cmd, { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' })
        return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
      }
      expect(run(['git', 'checkout', '--quiet', '-B', 'main', HEAD]).code).toBe(0)
      const logs = ['.werk/log.jsonl', 'e2e/fixture-project/.werk/log.jsonl', 'e2e/fixture-project/.werk/board.jsonl']
      const before = logs.map((l) => (existsSync(join(dir, l)) ? readFileSync(join(dir, l), 'utf8') : null))

      const r = run(['make', 'e2e'])
      console.log(r.out.slice(-3000))
      expect(r.code).toBe(0)
      const results = r.out.split('\n').filter((l) => /^\s+(✓|✘|-)\s+\d+ \[chromium\] › /.test(l))
      expect(results.length).toBeGreaterThan(0)
      const specs = readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))
      for (const s of specs) expect(results.some((l) => l.includes(s))).toBe(true)
      const shots = walk(join(dir, 'test-results')).filter((f) => f.endsWith('.png'))
      expect(shots.length).toBe(results.length)
      // The server ran on a copy: no log of the checkout changed.
      expect(logs.map((l) => (existsSync(join(dir, l)) ? readFileSync(join(dir, l), 'utf8') : null))).toEqual(before)
      expect(run(['git', 'status', '--porcelain']).out.trim()).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  30 * 60_000,
)
