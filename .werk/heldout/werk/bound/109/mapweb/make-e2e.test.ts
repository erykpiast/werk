/** 69.5: `make e2e` in a fresh clone outside the repo. */
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')

function walk(dir: string, name: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, name, out)
    else if (e === name) out.push(p)
  }
  return out
}

test(
  '69.5 make e2e runs the browser specs and leaves one screenshot per test',
  () => {
    const clone = join(mkdtempSync(join(tmpdir(), 'werk-e2e-clone-')), 'c')
    const c = spawnSync('git', ['clone', '--quiet', REPO, clone], { encoding: 'utf8' })
    expect(c.status).toBe(0)
    const fixtureLog = join(clone, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
    const before = readFileSync(fixtureLog, 'utf8')
    const rootLogBefore = existsSync(join(clone, '.werk', 'log.jsonl'))
    const specs = readdirSync(join(clone, 'e2e')).filter((f) => f.endsWith('.spec.ts'))

    const env = { ...process.env }
    delete env.WERK_LOG
    const r = spawnSync('make', ['e2e'], { cwd: clone, env: { ...env, CI: 'true' }, encoding: 'utf8', maxBuffer: 1 << 28 })
    const out = r.stdout + r.stderr
    console.log(out.slice(-4000))

    // A pass or fail result per spec: every spec file name shows in the list reporter output.
    for (const s of specs) expect(out).toContain(s)
    const summary = out.match(/(\d+) passed/)
    const failed = out.match(/(\d+) failed/)
    const ran = Number(summary?.[1] ?? 0) + Number(failed?.[1] ?? 0)
    expect(ran).toBeGreaterThan(0)
    // One screenshot per test that ran.
    const shots = walk(join(clone, 'test-results'), 'evidence.png')
    console.log(`ran=${ran} screenshots=${shots.length} exit=${r.status}`)
    expect(shots.length).toBe(ran)
    // A real server on a copy of the fixture: the fixture log is unchanged, and the checkout has no log of its own.
    expect(readFileSync(fixtureLog, 'utf8')).toBe(before)
    expect(existsSync(join(clone, '.werk', 'log.jsonl'))).toBe(rootLogBefore)
    const st = spawnSync('git', ['status', '--porcelain', '--', 'e2e', '.werk'], { cwd: clone, encoding: 'utf8' })
    expect(st.stdout.trim()).toBe('')
  },
  { timeout: 1_500_000 },
)
