/** Held-out steps 69.4 and 69.5: the server lock, and the browser test run. */
import { expect, test } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProject, serveProject } from '../../src/test/harness.ts'

test('69.4 a second server on the same project waits, then refuses', async () => {
  const p = makeProject()
  p.werk(['add', 'root', '--title', 'A root card'])
  p.werk(['accept', 'root', '--actor', 'you'])
  const first = serveProject(p)
  const url = await first.url
  const before = await (await fetch(`${url}api/graph`)).json()

  const t0 = Date.now()
  const second = serveProject(p)
  const code = await second.proc.exited
  const took = Date.now() - t0
  expect(second.stderr()).toMatch(new RegExp(`wait[^\\n]*${first.proc.pid}`))
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8_000)
  const errors = second.stderr().split('\n').filter((l) => l.startsWith('werk:'))
  expect(errors.some((l) => l.includes(String(first.proc.pid)))).toBe(true)

  const res = await fetch(url)
  expect(res.status).toBe(200)
  expect(await res.text()).toContain('<div id="root">')
  const after = await (await fetch(`${url}api/graph`)).json()
  expect(after).toEqual(before)
}, 30_000)

const REPO = join(import.meta.dir, '..', '..')

test('69.5 the person runs the browser tests and gets one screenshot per test', () => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
  try {
    const clone = join(root, 'werk')
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
    const git = Bun.spawnSync(['git', 'clone', '--quiet', REPO, clone], { env })
    expect(git.exitCode).toBe(0)
    // Reuse the installed packages so the run does not need the network.
    cpSync(join(REPO, 'node_modules'), join(clone, 'node_modules'), { recursive: true })
    const logPath = join(clone, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
    const logBefore = readFileSync(logPath, 'utf8')

    const run = Bun.spawnSync(['make', 'e2e'], { cwd: clone, env: { ...process.env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
    const out = run.stdout.toString() + run.stderr.toString()
    const results = out.split('\n').filter((l) => /^\s+(✓|✘|-)\s+\d+ \[chromium\]/.test(l))
    expect(results.length).toBeGreaterThan(0)
    expect(out).toMatch(/\d+ (passed|failed)/)

    const shots: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const path = join(d, f)
        if (statSync(path).isDirectory()) walk(path)
        else if (f.endsWith('.png')) shots.push(path)
      }
    }
    const resultsDir = join(clone, 'test-results')
    if (existsSync(resultsDir)) walk(resultsDir)
    const ran = results.filter((l) => /✓|✘/.test(l)).length
    expect(shots.filter((s) => s.endsWith('evidence.png')).length).toBe(ran)

    expect(readFileSync(logPath, 'utf8')).toBe(logBefore)
    const status = Bun.spawnSync(['git', 'status', '--porcelain', '--', 'e2e', 'src', '.werk'], { cwd: clone, env })
    expect(status.stdout.toString()).toBe('')
    console.log(`make e2e exit ${run.exitCode}; ${ran} tests ran; ${shots.length} screenshots`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 900_000)
