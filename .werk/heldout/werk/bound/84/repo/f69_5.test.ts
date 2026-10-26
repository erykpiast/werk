/** Feature 69, step 5: make e2e in a fresh clone. */
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = join(import.meta.dir, '..', '..')
let root = ''
afterAll(() => root && rmSync(root, { recursive: true, force: true }))

const sh = (cwd: string, cmd: string) => {
  const p = Bun.spawnSync(['sh', '-c', `${cmd} 2>&1`], { cwd, env: { ...process.env, CI: 'true' }, stdout: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() }
}
const find = (dir: string, name: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((f) => {
        const path = join(dir, f)
        return statSync(path).isDirectory() ? find(path, name) : f === name ? [path] : []
      })
    : []

test('69.5 the person runs the browser tests and gets one screenshot per test', () => {
  root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-clone-'))
  expect(sh(root, `git clone --quiet --branch main ${JSON.stringify(SOURCE)} werk`).code).toBe(0)
  const dir = join(root, 'werk')
  const fixtureLog = () => sh(dir, 'cat e2e/fixture-project/.werk/log.jsonl').out
  const before = fixtureLog()
  const r = sh(dir, 'make e2e')
  writeFileSync(join(import.meta.dir, 'out', '69.5-make-e2e.txt'), `exit ${r.code}\n${r.out}`)
  const ran = Number(/Running (\d+) tests?/.exec(r.out)?.[1])
  expect(ran).toBeGreaterThan(0)
  const results = r.out.split('\n').filter((l) => /^\s+[✓✘-]\s+\d+ \[chromium\]/.test(l))
  expect(results).toHaveLength(ran)
  const shots = find(join(dir, 'test-results'), 'evidence.png')
  expect(shots).toHaveLength(ran)
  // The specs boot their server on a copy of the fixture: the fixture and the checkout stay unchanged.
  expect(fixtureLog()).toBe(before)
  expect(sh(dir, 'git status --porcelain').out.trim()).toBe('')
  expect(existsSync(join(dir, '.werk'))).toBe(false)
  console.log(`69.5 make e2e exit ${r.code}, ${ran} tests, ${results.length} results, ${shots.length} screenshots`)
}, 30 * 60_000)
