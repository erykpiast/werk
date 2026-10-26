import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() }
}
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))

test('69.5 make e2e runs the browser specs and leaves one screenshot per test', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(tmp, 'werk')
  try {
    expect(sh(['git', 'clone', '--quiet', ROOT, dir], tmp).code).toBe(0)
    const logBefore = readFileSync(join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')
    const r = sh(['make', 'e2e'], dir)
    console.log(r.out.split('\n').filter((l) => /passed|failed|skipped/.test(l)).join('\n'))
    expect(r.code).toBe(0)
    const results = r.out.split('\n').filter((l) => /^\s*[✓✘-]\s+\d+ \[chromium\]/.test(l))
    expect(results.length).toBeGreaterThan(0)
    const shots = walk(join(dir, 'test-results')).filter((f) => f.endsWith('evidence.png'))
    expect(shots.length).toBe(results.length)
    expect(readFileSync(join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')).toBe(logBefore)
    expect(sh(['git', 'status', '--porcelain', '--', 'e2e', '.werk'], dir).out.trim()).toBe('')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}, 600_000)
