/** 69.5 runs `make e2e` in a fresh clone of this checkout, so the checkout itself stays as it is. */
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim()
let temp = ''
afterAll(() => temp && rmSync(temp, { recursive: true, force: true }))

const run = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

test(
  '69.5 the person runs the browser tests and gets one screenshot per test',
  () => {
    temp = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
    const dir = join(temp, 'werk')
    expect(run(['git', 'clone', '--quiet', ROOT, dir], temp).code).toBe(0)
    expect(run(['git', 'checkout', '--quiet', '--detach', HEAD], dir).code).toBe(0)
    const fixtureLog = readFileSync(join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')
    const ownLog = join(dir, '.werk', 'log.jsonl')
    const ownBefore = existsSync(ownLog) ? readFileSync(ownLog, 'utf8') : null

    const r = run(['make', 'e2e'], dir)
    const results = r.out.split('\n').filter((l) => /^\s+[✓✘-]\s+\d+ \[chromium\]/.test(l))
    const ran = results.filter((l) => !/^\s+-/.test(l))
    expect(ran.length).toBeGreaterThan(0)
    const outDir = join(dir, 'test-results')
    const shots = readdirSync(outDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(join(outDir, d.name)).filter((f) => f.endsWith('.png')).map((f) => join(d.name, f)))
    const evidence = shots.filter((s) => s.endsWith('evidence.png'))
    expect({ ran: ran.length, evidence: evidence.length, folders: new Set(evidence.map((s) => s.split('/')[0])).size }).toEqual({
      ran: ran.length,
      evidence: ran.length,
      folders: ran.length,
    })
    // The specs ran on a copy: the fixture's log and the person's own log are as before.
    expect(readFileSync(join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')).toBe(fixtureLog)
    expect(existsSync(ownLog) ? readFileSync(ownLog, 'utf8') : null).toBe(ownBefore)
    expect(run(['git', 'status', '--porcelain'], dir).out).toBe('')
    console.log(`69.5: make e2e exit ${r.code}; ${ran.length} tests reported; ${evidence.length} evidence screenshots`)
  },
  900_000,
)
