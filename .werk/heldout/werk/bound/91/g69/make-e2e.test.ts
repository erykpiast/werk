import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HERE = join(import.meta.dir, '..', '..')

function findEvidence(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('evidence.png'))
}

test('69.5 make e2e runs the specs, reports each, leaves one screenshot per test, and adds no events', () => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const clone = join(root, 'werk')
  const c = Bun.spawnSync(['git', 'clone', '--quiet', HERE, clone])
  expect(c.exitCode).toBe(0)
  const logFile = join(clone, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
  const before = readFileSync(logFile, 'utf8')
  const p = Bun.spawnSync(['make', 'e2e'], { cwd: clone, env: { ...process.env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  const out = p.stdout.toString() + p.stderr.toString()
  console.log(out.slice(-4000))
  const passed = out.match(/^\s*✓\s+\d+ \[chromium\]/gm) ?? []
  const failed = out.match(/^\s*✘\s+\d+ \[chromium\]/gm) ?? []
  const ran = passed.length + failed.length
  const shots = findEvidence(join(clone, 'test-results'))
  console.log({ exit: p.exitCode, passed: passed.length, failed: failed.length, shots: shots.length })
  const status = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: clone }).stdout.toString()
  console.log('git status:', JSON.stringify(status))
  expect(ran).toBeGreaterThan(0)
  expect(shots.length).toBe(ran)
  expect(readFileSync(logFile, 'utf8')).toBe(before)
  expect(existsSync(join(clone, '.werk'))).toBe(false)
  expect(status).toBe('')
  rmSync(root, { recursive: true, force: true })
}, 900_000)
