/** Held-out step 69.5: `make e2e` in a fresh copy of the checkout. */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECKOUT = join(import.meta.dir, '..', '..')

const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)])) : []

test('69.5 the person runs the browser tests and gets one screenshot per test', () => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-g6-clone-'))
  try {
    const clone = join(root, 'werk')
    expect(Bun.spawnSync(['git', 'clone', '--quiet', CHECKOUT, clone]).exitCode).toBe(0)
    const fixtureLog = join(clone, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
    const fixtureBefore = readFileSync(fixtureLog, 'utf8')
    const ownLog = join(clone, '.werk', 'log.jsonl')
    const ownBefore = existsSync(ownLog) ? readFileSync(ownLog, 'utf8') : null

    const env = { ...process.env, PATH: process.env.PATH!.split(':').slice(1).join(':') }
    const r = Bun.spawnSync(['make', 'e2e'], { cwd: clone, env, stdout: 'pipe', stderr: 'pipe' })
    const out = r.stdout.toString() + r.stderr.toString()
    console.log(out.split('\n').filter((l) => /✓|✘|passed|failed|skipped/.test(l)).join('\n'))

    const resultLines = out.split('\n').filter((l) => /^\s+[✓✘-]\s+\d+ \[chromium\]/.test(l))
    expect(resultLines.length).toBeGreaterThan(0)
    const ran = resultLines.filter((l) => /[✓✘]/.test(l)).length
    const shots = walk(join(clone, 'test-results')).filter((f) => f.endsWith('evidence.png'))
    expect(shots.length).toBe(ran)
    expect(readFileSync(fixtureLog, 'utf8')).toBe(fixtureBefore)
    expect(existsSync(ownLog) ? readFileSync(ownLog, 'utf8') : null).toBe(ownBefore)
    expect(Bun.spawnSync(['git', 'status', '--porcelain', '--', 'e2e', '.werk'], { cwd: clone }).stdout.toString()).toBe('')
    console.log(`make e2e exit ${r.exitCode}, ${ran} tests ran, ${shots.length} screenshots`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 900_000)
