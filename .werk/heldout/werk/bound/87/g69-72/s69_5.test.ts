import { expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

test('69.5 make e2e runs the specs and leaves one screenshot per test', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'werk-ho-e2e-')), 'werk')
  const c = Bun.spawnSync(['git', 'clone', '--quiet', ROOT, dir])
  expect(c.exitCode).toBe(0)
  const logBefore = readFileSync(join(dir, 'e2e/fixture-project/.werk/log.jsonl'), 'utf8')
  const r = Bun.spawnSync(['make', 'e2e'], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CI: 'true' } })
  const out = r.stdout.toString() + r.stderr.toString()
  console.log(out.split('\n').slice(-15).join('\n'))
  const results = [...out.matchAll(/^\s*(✓|✘|-)\s+\d+ \[chromium\]/gm)]
  const passedN = Number(/(\d+) passed/.exec(out)?.[1] ?? 0)
  const failedN = Number(/(\d+) failed/.exec(out)?.[1] ?? 0)
  expect(results.length).toBeGreaterThan(0)
  expect(results.length).toBe(passedN + failedN)
  const dirs = existsSync(join(dir, 'test-results')) ? readdirSync(join(dir, 'test-results')).filter((d) => !d.startsWith('.')) : []
  const shots = dirs.filter((d) => existsSync(join(dir, 'test-results', d, 'evidence.png')))
  console.log(`tests ${results.length}, result dirs ${dirs.length}, screenshots ${shots.length}, exit ${r.exitCode}`)
  expect(shots.length).toBe(results.length)
  expect(readFileSync(join(dir, 'e2e/fixture-project/.werk/log.jsonl'), 'utf8')).toBe(logBefore)
  const st = Bun.spawnSync(['git', 'status', '--porcelain', '--', '.werk', 'e2e'], { cwd: dir }).stdout.toString()
  expect(st).toBe('')
}, 600_000)
